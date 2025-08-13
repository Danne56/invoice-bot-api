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
      const tripCurrency = trip.currency || 'IDR';
      // Convert trip total to major by trip currency
      trip.total_amount_minor = parseInt(trip.total_amount || 0);
      trip.total_amount =
        tripCurrency === 'USD'
          ? Number(((trip.total_amount || 0) / 100).toFixed(2))
          : parseInt(trip.total_amount || 0);
      trip.currency = tripCurrency;

      // Map transactions with currency and dual amounts
      trip.transactions = transactions.map(t => {
        const currency = t.currency || tripCurrency;
        const row = {
          ...t,
          currency,
          total_amount_minor: t.total_amount ? parseInt(t.total_amount) : 0,
          total_amount: t.total_amount
            ? currency === 'USD'
              ? Number((parseInt(t.total_amount) / 100).toFixed(2))
              : parseInt(t.total_amount)
            : 0,
        };
        if (t.subtotal !== null && t.subtotal !== undefined) {
          row.subtotal_minor = parseInt(t.subtotal);
          row.subtotal =
            currency === 'USD'
              ? Number((parseInt(t.subtotal) / 100).toFixed(2))
              : parseInt(t.subtotal);
        }
        if (t.tax_amount !== null && t.tax_amount !== undefined) {
          row.tax_amount_minor = parseInt(t.tax_amount);
          row.tax_amount =
            currency === 'USD'
              ? Number((parseInt(t.tax_amount) / 100).toFixed(2))
              : parseInt(t.tax_amount);
        }
        return row;
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

      // Convert totals for each trip using trip currency
      trips.forEach(trip => {
        const currency = trip.currency || 'IDR';
        trip.total_amount_minor = parseInt(trip.total_amount || 0);
        trip.total_amount =
          currency === 'USD'
            ? Number(((trip.total_amount || 0) / 100).toFixed(2))
            : parseInt(trip.total_amount || 0);
        trip.currency = currency;
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
          COALESCE(SUM(total_amount), 0) as calculated_total,
          AVG(total_amount) as average_expense,
          MIN(total_amount) as min_expense,
          MAX(total_amount) as max_expense,
          COUNT(CASE WHEN merchant IS NOT NULL THEN 1 END) as transactions_with_merchant
        FROM transactions
        WHERE trip_id = ?
      `,
        [trip_id]
      );

      const trip = trips[0];
      const stats = summary[0];

      // Enforce single-currency for summary
      const [curRows] = await db.execute(
        `SELECT DISTINCT currency FROM transactions WHERE trip_id = ?`,
        [trip_id]
      );
      const distinctCurrencies = curRows.map(r => r.currency).filter(Boolean);
      const tripCurrency = trip.currency || 'IDR';
      if (
        distinctCurrencies.length > 1 ||
        (distinctCurrencies.length === 1 &&
          distinctCurrencies[0] !== tripCurrency)
      ) {
        return res.status(400).json({
          error:
            'Mixed currencies detected in this trip. Single-currency per trip is enforced.',
          details: {
            currencies: distinctCurrencies,
            trip_currency: tripCurrency,
          },
        });
      }

      res.status(200).json({
        trip_info: {
          id: trip.id,
          event_name: trip.event_name,
          phone_number: trip.phone_number,
          started_at: trip.started_at,
          ended_at: trip.ended_at,
          status: trip.status,
          currency: tripCurrency,
          recorded_total_minor: parseInt(trip.total_amount),
          recorded_total:
            tripCurrency === 'USD'
              ? Number((parseInt(trip.total_amount) / 100).toFixed(2))
              : parseInt(trip.total_amount),
        },
        expense_summary: {
          total_transactions: parseInt(stats.total_transactions),
          calculated_total_minor: parseInt(stats.calculated_total),
          calculated_total:
            tripCurrency === 'USD'
              ? Number((parseInt(stats.calculated_total) / 100).toFixed(2))
              : parseInt(stats.calculated_total),
          average_expense_minor: parseInt(stats.average_expense || 0),
          average_expense:
            tripCurrency === 'USD'
              ? Number((parseInt(stats.average_expense || 0) / 100).toFixed(2))
              : parseInt(stats.average_expense || 0),
          min_expense_minor: parseInt(stats.min_expense || 0),
          min_expense:
            tripCurrency === 'USD'
              ? Number((parseInt(stats.min_expense || 0) / 100).toFixed(2))
              : parseInt(stats.min_expense || 0),
          max_expense_minor: parseInt(stats.max_expense || 0),
          max_expense:
            tripCurrency === 'USD'
              ? Number((parseInt(stats.max_expense || 0) / 100).toFixed(2))
              : parseInt(stats.max_expense || 0),
          transactions_with_merchant: parseInt(
            stats.transactions_with_merchant
          ),
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
