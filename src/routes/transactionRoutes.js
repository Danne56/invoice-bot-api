const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();

// Helpers for currency handling
function toMinor(currency, value) {
  if (currency === 'USD') {
    // Support numbers or numeric strings, round to cents
    const num = typeof value === 'string' ? Number(value) : value;
    return Math.round(num * 100);
  }
  // IDR: already integer rupiah
  return parseInt(value);
}

function toMajor(currency, minor) {
  const n = typeof minor === 'string' ? parseInt(minor) : minor;
  if (currency === 'USD') {
    return Number((n / 100).toFixed(2));
  }
  return n; // IDR
}

function isValidAmountByCurrency(currency, raw, { allowZero = false } = {}) {
  if (currency === 'USD') {
    // allow up to 2 decimals
    const str = String(raw);
    if (!/^\d+(?:\.\d{1,2})?$/.test(str)) return false;
    const num = Number(str);
    return allowZero ? num >= 0 : num > 0;
  }
  // IDR must be integer
  if (!/^\d+$/.test(String(raw))) return false;
  const num = parseInt(raw);
  return allowZero ? num >= 0 : num > 0;
}

function formatAmountForDisplay(currency, minorAmount) {
  const major =
    currency === 'USD' ? Number((minorAmount / 100).toFixed(2)) : minorAmount;
  const symbol = currency === 'USD' ? '$' : 'Rp';

  if (currency === 'USD') {
    const formatted = major.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${symbol} ${formatted}`;
  } else {
    // IDR: Use Indonesian format with periods as thousand separators
    const formatted = major.toLocaleString('id-ID').replace(/,/g, '.');
    return `${symbol}${formatted}`;
  }
}

async function getTripAndEnforceCurrency(db, tripId, requestedCurrency) {
  const [trips] = await db.execute(
    `SELECT id, status, event_name, currency FROM trips WHERE id = ?`,
    [tripId]
  );
  if (trips.length === 0) return { notFound: true };
  const trip = trips[0];
  if (trip.status !== 'active') {
    return { trip, completed: true };
  }
  // If trip has a currency set and request specifies a different one, reject
  if (
    trip.currency &&
    requestedCurrency &&
    trip.currency !== requestedCurrency
  ) {
    return { trip, currencyMismatch: true };
  }
  return { trip };
}

/**
 * POST /api/transactions
 * Create a new invoice/receipt transaction
 */
router.post(
  '/',
  body('trip_id')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  body('currency')
    .optional()
    .isIn(['IDR', 'USD'])
    .withMessage('Currency must be IDR or USD'),
  body('total_amount').custom((value, { req }) => {
    const currency = req.body.currency || 'IDR';
    if (!isValidAmountByCurrency(currency, value)) {
      throw new Error(
        currency === 'USD'
          ? 'Total amount (USD) must be a positive number with up to 2 decimals'
          : 'Total amount (IDR) must be a positive integer'
      );
    }
    return true;
  }),
  body('merchant')
    .optional()
    .isLength({ max: 100 })
    .trim()
    .withMessage('Merchant name must be less than 100 characters'),
  body('date')
    .optional()
    .isISO8601()
    .withMessage('Date must be in ISO 8601 format (YYYY-MM-DD)'),
  body('subtotal')
    .optional()
    .custom((value, { req }) => {
      const currency = req.body.currency || 'IDR';
      if (!isValidAmountByCurrency(currency, value, { allowZero: true })) {
        throw new Error(
          currency === 'USD'
            ? 'Subtotal (USD) must be a non-negative number with up to 2 decimals'
            : 'Subtotal (IDR) must be a non-negative integer'
        );
      }
      return true;
    }),
  body('tax_amount')
    .optional()
    .custom((value, { req }) => {
      const currency = req.body.currency || 'IDR';
      if (!isValidAmountByCurrency(currency, value, { allowZero: true })) {
        throw new Error(
          currency === 'USD'
            ? 'Tax amount (USD) must be a non-negative number with up to 2 decimals'
            : 'Tax amount (IDR) must be a non-negative integer'
        );
      }
      return true;
    }),
  body('item_count')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Item count must be a positive integer'),
  body('item_summary')
    .optional()
    .isLength({ max: 5000 })
    .trim()
    .withMessage('Item summary must be less than 5000 characters'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        { errors: errors.array(), reqBody: req.body },
        'Validation failed for /api/transactions'
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      trip_id,
      total_amount,
      merchant,
      date,
      subtotal,
      tax_amount,
      item_count,
      item_summary,
      currency = 'IDR',
    } = req.body;
    const transactionId = generateId(12);
    const db = await pool.getConnection();

    try {
      // Verify trip exists and is active
      const result = await getTripAndEnforceCurrency(db, trip_id, currency);
      if (result.notFound) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      if (result.completed) {
        return res
          .status(400)
          .json({ error: 'Cannot add transactions to a completed trip' });
      }
      if (result.currencyMismatch) {
        return res.status(400).json({
          error: `Trip currency (${result.trip.currency}) does not match transaction currency (${currency})`,
        });
      }
      const trip = result.trip;

      // Create transaction with new invoice schema
      await db.execute(
        `
        INSERT INTO transactions (id, trip_id, currency, merchant, date, total_amount, subtotal, tax_amount, item_count, item_summary, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
        [
          transactionId,
          trip_id,
          currency,
          merchant || null,
          date || null,
          toMinor(currency, total_amount),
          subtotal !== undefined ? toMinor(currency, subtotal) : null,
          tax_amount !== undefined ? toMinor(currency, tax_amount) : null,
          item_count ? parseInt(item_count) : null,
          item_summary || null,
        ]
      );

      // If trip has no currency set (legacy), set it now to enforce single-currency per trip
      if (!trip.currency) {
        await db.execute(`UPDATE trips SET currency = ? WHERE id = ?`, [
          currency,
          trip_id,
        ]);
      }

      logger.info(
        {
          transactionId,
          trip_id,
          total_amount: parseInt(total_amount),
          merchant: merchant || 'No merchant',
          item_count: item_count || 0,
        },
        'Invoice transaction created successfully'
      );

      // Format amount with thousand separators for IDR
      const major = toMajor(currency, toMinor(currency, total_amount));
      const minorAmount = toMinor(currency, total_amount);
      const displayAmount = formatAmountForDisplay(currency, minorAmount);
      const message = `Invoice of ${displayAmount} recorded successfully`;

      res.status(201).json({
        success: true,
        transaction_id: transactionId,
        trip_id,
        currency,
        amount: major,
        display_amount: displayAmount,
        merchant: merchant || null,
        message,
      });
    } catch (err) {
      logger.error({ err, reqBody: req.body }, 'Failed to create transaction');
      res.status(500).json({ error: 'Failed to record transaction' });
    } finally {
      db.release();
    }
  }
);

/**
 * GET /api/transactions/:transaction_id
 * Get transaction details
 */
router.get(
  '/:transaction_id',
  param('transaction_id')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid transaction ID'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { transaction_id } = req.params;
    const db = await pool.getConnection();

    try {
      const [transactions] = await db.execute(
        `
        SELECT t.*, tr.event_name, tr.phone_number
        FROM transactions t
        JOIN trips tr ON t.trip_id = tr.id
        WHERE t.id = ?
      `,
        [transaction_id]
      );

      if (transactions.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      const t = transactions[0];
      const currency = t.currency || 'IDR';
      const payload = {
        ...t,
        currency,
        amount: t.total_amount ? toMajor(currency, t.total_amount) : 0,
        display_amount: t.total_amount
          ? formatAmountForDisplay(currency, parseInt(t.total_amount))
          : formatAmountForDisplay(currency, 0),
      };
      if (t.subtotal !== null && t.subtotal !== undefined) {
        payload.subtotal_amount = toMajor(currency, t.subtotal);
        payload.subtotal_display = formatAmountForDisplay(
          currency,
          parseInt(t.subtotal)
        );
      }
      if (t.tax_amount !== null && t.tax_amount !== undefined) {
        payload.tax_amount = toMajor(currency, t.tax_amount);
        payload.tax_display = formatAmountForDisplay(
          currency,
          parseInt(t.tax_amount)
        );
      }

      res.status(200).json({ data: payload });
    } catch (err) {
      logger.error({ err, transaction_id }, 'Failed to fetch transaction');
      res.status(500).json({ error: 'Failed to fetch transaction' });
    } finally {
      db.release();
    }
  }
);

/**
 * GET /api/transactions
 * Get transactions with filtering options
 */
router.get(
  '/',
  query('trip_id')
    .optional()
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  query('merchant')
    .optional()
    .isLength({ max: 100 })
    .trim()
    .withMessage('Merchant filter must be less than 100 characters'),
  query('date_from')
    .optional()
    .isISO8601()
    .withMessage('Date from must be in ISO 8601 format (YYYY-MM-DD)'),
  query('date_to')
    .optional()
    .isISO8601()
    .withMessage('Date to must be in ISO 8601 format (YYYY-MM-DD)'),
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

    const {
      trip_id,
      merchant,
      date_from,
      date_to,
      limit = 20,
      offset = 0,
    } = req.query;
    const db = await pool.getConnection();

    try {
      let query = `
        SELECT t.*, tr.event_name, tr.phone_number
        FROM transactions t
        JOIN trips tr ON t.trip_id = tr.id
        WHERE 1=1
      `;
      const params = [];

      if (trip_id) {
        query += ' AND t.trip_id = ?';
        params.push(trip_id);
      }

      if (merchant) {
        query += ' AND t.merchant LIKE ?';
        params.push(`%${merchant}%`);
      }

      if (date_from) {
        query += ' AND t.date >= ?';
        params.push(date_from);
      }

      if (date_to) {
        query += ' AND t.date <= ?';
        params.push(date_to);
      }

      query += `
        ORDER BY t.recorded_at DESC
        LIMIT ? OFFSET ?
      `;
      params.push(parseInt(limit), parseInt(offset));

      const [transactions] = await db.execute(query, params);

      // Map with currency and dual amounts
      const data = transactions.map(t => {
        const currency = t.currency || 'IDR';
        const row = {
          ...t,
          currency,
          amount: t.total_amount ? toMajor(currency, t.total_amount) : 0,
          display_amount: t.total_amount
            ? formatAmountForDisplay(currency, parseInt(t.total_amount))
            : formatAmountForDisplay(currency, 0),
        };
        if (t.subtotal !== null && t.subtotal !== undefined) {
          row.subtotal_amount = toMajor(currency, t.subtotal);
          row.subtotal_display = formatAmountForDisplay(
            currency,
            parseInt(t.subtotal)
          );
        }
        if (t.tax_amount !== null && t.tax_amount !== undefined) {
          row.tax_amount = toMajor(currency, t.tax_amount);
          row.tax_display = formatAmountForDisplay(
            currency,
            parseInt(t.tax_amount)
          );
        }
        return row;
      });

      res.status(200).json({
        data,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch transactions');
      res.status(500).json({ error: 'Failed to fetch transactions' });
    } finally {
      db.release();
    }
  }
);

module.exports = router;
