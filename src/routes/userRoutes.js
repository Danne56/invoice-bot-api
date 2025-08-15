const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();
/**
 * POST /api/users
 * Create a user independently (no trip creation)
 */
router.post(
  '/',
  body('phone_number')
    .isMobilePhone('any')
    .notEmpty()
    .withMessage('Invalid phone number'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        { errors: errors.array(), reqBody: req.body },
        'Validation failed for POST /api/users'
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone_number } = req.body;
    const userId = generateId(12);
    const db = await pool.getConnection();
    try {
      await db.execute(
        `INSERT INTO users (id, phone_number, is_active, created_at, updated_at)
         VALUES (?, ?, 0, NOW(), NOW())
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [userId, phone_number]
      );

      // Fetch current state
      const [rows] = await db.execute(
        `SELECT id, phone_number, is_active, current_trip_id, created_at, updated_at
         FROM users WHERE phone_number = ?`,
        [phone_number]
      );
      const user = rows[0];

      res.status(201).json({ data: user });
    } catch (err) {
      await db.rollback();
      logger.error({ err, reqBody: req.body }, 'Failed to create user');
      res.status(500).json({ error: 'Failed to create user' });
    } finally {
      db.release();
    }
  }
);

/**
 * GET /api/users/:phone_number
 * Get user information including current trip and transaction count.
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
        SELECT
          u.*,
          t.event_name as current_trip_name,
          t.started_at as trip_started_at,
          t.total_amount,
          t.currency as current_trip_currency,
          COUNT(tr.id) as transaction_count
        FROM users u
        LEFT JOIN trips t ON u.current_trip_id = t.id
        LEFT JOIN transactions tr ON t.id = tr.trip_id
        WHERE u.phone_number = ?
        GROUP BY u.id, t.id
      `,
        [phone_number]
      );

      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];
      user.transaction_count = parseInt(user.transaction_count || 0);

      // Convert total_amount to integer for IDR if it exists
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

module.exports = router;
