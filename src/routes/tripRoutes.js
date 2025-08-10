const express = require('express');
const { param, query, validationResult } = require('express-validator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/trips/:trip_id
 * Get trip details with transactions
 */
router.get(
  '/:trip_id',
  param('trip_id')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { trip_id } = req.params;
    const db = await pool.getConnection();

    try {
      // Get trip details
      const [trips] = await db.execute(
        `
        SELECT * FROM trips WHERE id = ?
      `,
        [trip_id]
      );

      if (trips.length === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }

      // Get transactions for this trip
      const [transactions] = await db.execute(
        `
        SELECT * FROM transactions
        WHERE trip_id = ?
        ORDER BY recorded_at DESC
      `,
        [trip_id]
      );

      const trip = trips[0];
      trip.transactions = transactions;
      trip.total_amount = parseInt(trip.total_amount); // Convert to integer for IDR

      // Convert transaction amounts to integers for IDR
      trip.transactions.forEach(transaction => {
        transaction.amount = parseInt(transaction.amount);
      });

      res.status(200).json({ data: trip });
    } catch (err) {
      logger.error({ err, trip_id }, 'Failed to fetch trip');
      res.status(500).json({ error: 'Failed to fetch trip' });
    } finally {
      db.release();
    }
  }
);

/**
 * GET /api/trips
 * Get trips for a user with optional filtering
 */
router.get(
  '/',
  query('phone_number')
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  query('status')
    .optional()
    .isIn(['active', 'completed'])
    .withMessage('Status must be active or completed'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be non-negative'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone_number, status, limit = 10, offset = 0 } = req.query;
    const db = await pool.getConnection();

    try {
      let query = `
        SELECT t.*, COUNT(tr.id) as transaction_count
        FROM trips t
        LEFT JOIN transactions tr ON t.id = tr.trip_id
        WHERE t.phone_number = ?
      `;
      const params = [phone_number];

      if (status) {
        query += ' AND t.status = ?';
        params.push(status);
      }

      query += `
        GROUP BY t.id
        ORDER BY t.started_at DESC
        LIMIT ? OFFSET ?
      `;
      params.push(parseInt(limit), parseInt(offset));

      const [trips] = await db.execute(query, params);

      // Convert total_amount to integer for each trip (IDR)
      trips.forEach(trip => {
        trip.total_amount = parseInt(trip.total_amount);
        trip.transaction_count = parseInt(trip.transaction_count);
      });

      res.status(200).json({
        data: trips,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (err) {
      logger.error({ err, phone_number }, 'Failed to fetch trips');
      res.status(500).json({ error: 'Failed to fetch trips' });
    } finally {
      db.release();
    }
  }
);

/**
 * GET /api/trips/:trip_id/summary
 * Get trip summary with expense breakdown
 */
router.get(
  '/:trip_id/summary',
  param('trip_id')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { trip_id } = req.params;
    const db = await pool.getConnection();

    try {
      // Get trip basic info
      const [trips] = await db.execute(
        `
        SELECT id, event_name, phone_number, started_at, ended_at, total_amount, status
        FROM trips WHERE id = ?
      `,
        [trip_id]
      );

      if (trips.length === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }

      // Get transaction summary
      const [summary] = await db.execute(
        `
        SELECT
          COUNT(*) as total_transactions,
          COALESCE(SUM(amount), 0) as calculated_total,
          AVG(amount) as average_expense,
          MIN(amount) as min_expense,
          MAX(amount) as max_expense,
          SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
        FROM transactions
        WHERE trip_id = ?
      `,
        [trip_id]
      );

      const trip = trips[0];
      const stats = summary[0];

      res.status(200).json({
        trip_info: {
          id: trip.id,
          event_name: trip.event_name,
          phone_number: trip.phone_number,
          started_at: trip.started_at,
          ended_at: trip.ended_at,
          status: trip.status,
          recorded_total: parseInt(trip.total_amount), // Convert to integer for IDR
        },
        expense_summary: {
          total_transactions: parseInt(stats.total_transactions),
          calculated_total: parseInt(stats.calculated_total), // Convert to integer for IDR
          average_expense: parseInt(stats.average_expense || 0), // Convert to integer for IDR
          min_expense: parseInt(stats.min_expense || 0), // Convert to integer for IDR
          max_expense: parseInt(stats.max_expense || 0), // Convert to integer for IDR
          processed_transactions: parseInt(stats.processed_count),
          pending_transactions: parseInt(stats.pending_count),
          failed_transactions: parseInt(stats.failed_count),
        },
      });
    } catch (err) {
      logger.error({ err, trip_id }, 'Failed to fetch trip summary');
      res.status(500).json({ error: 'Failed to fetch trip summary' });
    } finally {
      db.release();
    }
  }
);

module.exports = router;
