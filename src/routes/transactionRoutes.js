const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();

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
  body('total_amount')
    .isInt({ min: 1 })
    .withMessage(
      'Total amount must be a positive whole number (Indonesian Rupiah)'
    ),
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
    .isInt({ min: 0 })
    .withMessage(
      'Subtotal must be a non-negative whole number (Indonesian Rupiah)'
    ),
  body('tax_amount')
    .optional()
    .isInt({ min: 0 })
    .withMessage(
      'Tax amount must be a non-negative whole number (Indonesian Rupiah)'
    ),
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
    } = req.body;
    const transactionId = generateId(12);
    const db = await pool.getConnection();

    try {
      // Verify trip exists and is active
      const [trips] = await db.execute(
        `
        SELECT id, status, event_name FROM trips WHERE id = ?
      `,
        [trip_id]
      );

      if (trips.length === 0) {
        return res.status(404).json({ error: 'Trip not found' });
      }

      if (trips[0].status !== 'active') {
        return res
          .status(400)
          .json({ error: 'Cannot add transactions to a completed trip' });
      }

      // Create transaction with new invoice schema
      await db.execute(
        `
        INSERT INTO transactions (id, trip_id, merchant, date, total_amount, subtotal, tax_amount, item_count, item_summary, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
        [
          transactionId,
          trip_id,
          merchant || null,
          date || null,
          parseInt(total_amount),
          subtotal ? parseInt(subtotal) : null,
          tax_amount ? parseInt(tax_amount) : null,
          item_count ? parseInt(item_count) : null,
          item_summary || null,
        ]
      );

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
      const formattedAmount = parseInt(total_amount).toLocaleString('id-ID');

      res.status(201).json({
        success: true,
        transaction_id: transactionId,
        trip_id,
        total_amount: parseInt(total_amount),
        merchant: merchant || null,
        message: `Invoice of Rp ${formattedAmount} recorded successfully`,
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

      const transaction = transactions[0];
      // Convert amounts to integers for IDR
      transaction.total_amount = parseInt(transaction.total_amount);
      if (transaction.subtotal)
        transaction.subtotal = parseInt(transaction.subtotal);
      if (transaction.tax_amount)
        transaction.tax_amount = parseInt(transaction.tax_amount);

      res.status(200).json({ data: transaction });
    } catch (err) {
      logger.error({ err, transaction_id }, 'Failed to fetch transaction');
      res.status(500).json({ error: 'Failed to fetch transaction' });
    } finally {
      db.release();
    }
  }
);

/**
 * PUT /api/transactions/:transaction_id
 * Update transaction details
 */
router.put(
  '/:transaction_id',
  param('transaction_id')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid transaction ID'),
  body('total_amount')
    .optional()
    .isInt({ min: 1 })
    .withMessage(
      'Total amount must be a positive whole number (Indonesian Rupiah)'
    ),
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
    .isInt({ min: 0 })
    .withMessage(
      'Subtotal must be a non-negative whole number (Indonesian Rupiah)'
    ),
  body('tax_amount')
    .optional()
    .isInt({ min: 0 })
    .withMessage(
      'Tax amount must be a non-negative whole number (Indonesian Rupiah)'
    ),
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
      return res.status(400).json({ errors: errors.array() });
    }

    const { transaction_id } = req.params;
    const {
      total_amount,
      merchant,
      date,
      subtotal,
      tax_amount,
      item_count,
      item_summary,
    } = req.body;
    const db = await pool.getConnection();

    try {
      // Check if transaction exists and get trip status
      const [existing] = await db.execute(
        `
        SELECT t.*, tr.status as trip_status
        FROM transactions t
        JOIN trips tr ON t.trip_id = tr.id
        WHERE t.id = ?
      `,
        [transaction_id]
      );

      if (existing.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (existing[0].trip_status === 'completed') {
        return res
          .status(400)
          .json({ error: 'Cannot modify transactions for a completed trip' });
      }

      // Build update query dynamically
      const updates = [];
      const params = [];

      if (total_amount !== undefined) {
        updates.push('total_amount = ?');
        params.push(parseInt(total_amount));
      }
      if (merchant !== undefined) {
        updates.push('merchant = ?');
        params.push(merchant);
      }
      if (date !== undefined) {
        updates.push('date = ?');
        params.push(date);
      }
      if (subtotal !== undefined) {
        updates.push('subtotal = ?');
        params.push(subtotal ? parseInt(subtotal) : null);
      }
      if (tax_amount !== undefined) {
        updates.push('tax_amount = ?');
        params.push(tax_amount ? parseInt(tax_amount) : null);
      }
      if (item_count !== undefined) {
        updates.push('item_count = ?');
        params.push(item_count ? parseInt(item_count) : null);
      }
      if (item_summary !== undefined) {
        updates.push('item_summary = ?');
        params.push(item_summary);
      }

      if (updates.length === 0) {
        return res
          .status(400)
          .json({ error: 'No valid fields provided for update' });
      }

      params.push(transaction_id);

      await db.execute(
        `
        UPDATE transactions
        SET ${updates.join(', ')}
        WHERE id = ?
      `,
        params
      );

      logger.info(
        { transaction_id, updates },
        'Transaction updated successfully'
      );

      res.status(200).json({
        success: true,
        transaction_id,
        message: 'Transaction updated successfully',
      });
    } catch (err) {
      logger.error({ err, transaction_id }, 'Failed to update transaction');
      res.status(500).json({ error: 'Failed to update transaction' });
    } finally {
      db.release();
    }
  }
);

/**
 * DELETE /api/transactions/:transaction_id
 * Delete a transaction
 */
router.delete(
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
      // Check if transaction exists and get trip status
      const [existing] = await db.execute(
        `
        SELECT t.*, tr.status as trip_status
        FROM transactions t
        JOIN trips tr ON t.trip_id = tr.id
        WHERE t.id = ?
      `,
        [transaction_id]
      );

      if (existing.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (existing[0].trip_status === 'completed') {
        return res
          .status(400)
          .json({ error: 'Cannot delete transactions from a completed trip' });
      }

      // Delete transaction
      await db.execute('DELETE FROM transactions WHERE id = ?', [
        transaction_id,
      ]);

      logger.info({ transaction_id }, 'Transaction deleted successfully');

      res.status(200).json({
        success: true,
        message: 'Transaction deleted successfully',
      });
    } catch (err) {
      logger.error({ err, transaction_id }, 'Failed to delete transaction');
      res.status(500).json({ error: 'Failed to delete transaction' });
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

      // Convert amounts to integers for IDR
      transactions.forEach(transaction => {
        transaction.total_amount = parseInt(transaction.total_amount);
        if (transaction.subtotal)
          transaction.subtotal = parseInt(transaction.subtotal);
        if (transaction.tax_amount)
          transaction.tax_amount = parseInt(transaction.tax_amount);
      });

      res.status(200).json({
        data: transactions,
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
