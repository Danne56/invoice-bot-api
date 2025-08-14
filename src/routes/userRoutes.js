const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/users/start
 * Start a new trip for a user
 */
router.post(
  '/start',
  body('phone_number')
    .isMobilePhone('any')
    .notEmpty()
    .withMessage('Invalid phone number'),
  body('event_name')
    .isLength({ min: 1, max: 255 })
    .trim()
    .escape()
    .withMessage('Event name is required and must be less than 255 characters'),
  body('currency')
    .optional()
    .isIn(['IDR', 'USD'])
    .withMessage('Currency must be IDR or USD'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        { errors: errors.array(), reqBody: req.body },
        'Validation failed for /api/users/start'
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone_number, event_name, currency = 'IDR' } = req.body;
    const userId = generateId(12);
    const tripId = generateId(12);
    const db = await pool.getConnection();

    try {
      // Start a transaction for atomicity
      await db.beginTransaction();

      // Check if user already has an active trip
      const [existingTrip] = await db.execute(
        `
        SELECT id, event_name
        FROM trips
        WHERE phone_number = ? AND status = 'active'
      `,
        [phone_number]
      );

      if (existingTrip.length > 0) {
        await db.rollback();
        return res.status(400).json({
          error: 'You already have an active trip',
          active_trip: existingTrip[0],
        });
      }

      // 1. Create or update user
      await db.execute(
        `
        INSERT INTO users (id, phone_number, is_active, current_trip_id, created_at, updated_at)
        VALUES (?, ?, 1, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          is_active = 1,
          current_trip_id = VALUES(current_trip_id),
          updated_at = NOW()
      `,
        [userId, phone_number, tripId]
      );

      // 2. Create new trip
      await db.execute(
        `
        INSERT INTO trips (id, phone_number, event_name, currency, started_at, status)
        VALUES (?, ?, ?, ?, NOW(), 'active')
      `,
        [tripId, phone_number, event_name, currency]
      );

      await db.commit();

      logger.info(
        { userId, tripId, phone_number, event_name },
        'New trip started successfully'
      );
      res.status(201).json({
        success: true,
        user_id: userId,
        trip_id: tripId,
        currency,
        message: `Trip '${event_name}' started successfully (currency: ${currency}).`,
      });
    } catch (err) {
      await db.rollback();
      logger.error({ err, reqBody: req.body }, 'Failed to start trip');
      res.status(500).json({ error: 'Failed to start trip' });
    } finally {
      db.release();
    }
  }
);

/**
 * POST /api/users/stop
 * Stop the current active trip for a user
 */
router.post(
  '/stop',
  body('phone_number')
    .isMobilePhone('any')
    .notEmpty()
    .withMessage('Invalid phone number'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        { errors: errors.array(), reqBody: req.body },
        'Validation failed for /api/users/stop'
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone_number } = req.body;
    const db = await pool.getConnection();

    try {
      await db.beginTransaction();

      // Find active trip for user
      const [activeTrip] = await db.execute(
        `
        SELECT t.id, t.event_name, t.total_amount, t.currency
        FROM trips t
        WHERE t.phone_number = ? AND t.status = 'active'
      `,
        [phone_number]
      );

      if (activeTrip.length === 0) {
        await db.rollback();
        return res.status(400).json({ error: 'No active trip found' });
      }

      const trip = activeTrip[0];

      // Calculate total amount from transactions
      const [totalResult] = await db.execute(
        `
        SELECT COALESCE(SUM(total_amount), 0) as total_amount
        FROM transactions
        WHERE trip_id = ?
      `,
        [trip.id]
      );

      const finalTotal = totalResult[0].total_amount;

      // 1. Update trip status and total
      await db.execute(
        `
        UPDATE trips
        SET status = 'completed', ended_at = NOW(), total_amount = ?
        WHERE id = ?
      `,
        [finalTotal, trip.id]
      );

      // 2. Update user status
      await db.execute(
        `
        UPDATE users
        SET is_active = 0, current_trip_id = NULL, updated_at = NOW()
        WHERE phone_number = ?
      `,
        [phone_number]
      );

      await db.commit();

      logger.info(
        { tripId: trip.id, phone_number, finalTotal },
        'Trip stopped successfully'
      );

      // Format amount with thousand separators for IDR
      const currency = trip.currency || 'IDR';
      const totalMinor = parseInt(finalTotal);
      const totalMajor =
        currency === 'USD' ? Number((totalMinor / 100).toFixed(2)) : totalMinor;
      const formatted =
        currency === 'USD'
          ? totalMajor.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : totalMajor.toLocaleString('id-ID');
      const symbol = currency === 'USD' ? '$' : 'Rp';

      res.status(200).json({
        success: true,
        trip_id: trip.id,
        event_name: trip.event_name,
        currency,
        total_amount_minor: totalMinor,
        total_amount: totalMajor,
        message: `Trip '${trip.event_name}' completed with total expense: ${symbol} ${formatted}`,
      });
    } catch (err) {
      await db.rollback();
      logger.error({ err, reqBody: req.body }, 'Failed to stop trip');
      res.status(500).json({ error: 'Failed to stop trip' });
    } finally {
      db.release();
    }
  }
);

/**
 * GET /api/users/:phone_number
 * Get user information including current trip
 */
router.get(
  '/:phone_number',
  param('phone_number')
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone_number } = req.params;
    const db = await pool.getConnection();

    try {
      const [users] = await db.execute(
        `
        SELECT u.*, t.event_name as current_trip_name, t.started_at as trip_started_at, t.total_amount, t.currency as current_trip_currency
        FROM users u
        LEFT JOIN trips t ON u.current_trip_id = t.id
        WHERE u.phone_number = ?
      `,
        [phone_number]
      );

      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Convert total_amount to integer for IDR if it exists
      const user = users[0];
      if (user.total_amount !== null) {
        const currency = user.current_trip_currency || 'IDR';
        const minor = parseInt(user.total_amount);
        const major =
          currency === 'USD' ? Number((minor / 100).toFixed(2)) : minor;
        user.total_amount_minor = minor;
        user.total_amount = major;
        user.currency = currency;
      }

      res.status(200).json({ data: user });
    } catch (err) {
      logger.error({ err, phone_number }, 'Failed to fetch user');
      res.status(500).json({ error: 'Failed to fetch user' });
    } finally {
      db.release();
    }
  }
);

/**
 * GET /api/users/:phone_number/status
 * Get user's current trip status
 */
router.get(
  '/:phone_number/status',
  param('phone_number')
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone_number } = req.params;
    const db = await pool.getConnection();

    try {
      const [result] = await db.execute(
        `
        SELECT
          u.is_active,
          t.id as trip_id,
          t.event_name,
          t.started_at,
          t.total_amount,
          t.currency,
          COUNT(tr.id) as transaction_count
        FROM users u
        LEFT JOIN trips t ON u.current_trip_id = t.id
        LEFT JOIN transactions tr ON t.id = tr.trip_id
        WHERE u.phone_number = ?
        GROUP BY u.id, t.id
      `,
        [phone_number]
      );

      if (result.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const status = result[0];
      res.status(200).json({
        is_active: Boolean(status.is_active),
        current_trip: status.trip_id
          ? (() => {
              const currency = status.currency || 'IDR';
              const minor = parseInt(status.total_amount || 0);
              const major =
                currency === 'USD' ? Number((minor / 100).toFixed(2)) : minor;
              return {
                trip_id: status.trip_id,
                event_name: status.event_name,
                started_at: status.started_at,
                currency,
                total_amount_minor: minor,
                total_amount: major,
                transaction_count: parseInt(status.transaction_count || 0),
              };
            })()
          : null,
      });
    } catch (err) {
      logger.error({ err, phone_number }, 'Failed to fetch user status');
      res.status(500).json({ error: 'Failed to fetch user status' });
    } finally {
      db.release();
    }
  }
);

module.exports = router;
