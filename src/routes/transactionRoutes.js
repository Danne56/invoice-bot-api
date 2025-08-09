const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/transactions
 * Create a new expense transaction
 */
router.post(
  '/',
  body('trip_id')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  body('amount')
    .isFloat({ min: 0 })
    .withMessage('Amount must be a positive number'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .trim()
    .withMessage('Description must be less than 1000 characters'),
  body('photo_url')
    .optional()
    .isURL()
    .withMessage('Photo URL must be a valid URL'),
  body('ocr_text')
    .optional()
    .isLength({ max: 5000 })
    .trim()
    .withMessage('OCR text must be less than 5000 characters'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        { errors: errors.array(), reqBody: req.body },
        'Validation failed for /api/transactions'
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const { trip_id, amount, description, photo_url, ocr_text } = req.body;
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
          .json({ error: 'Cannot add expenses to a completed trip' });
      }

      // Create transaction
      await db.execute(
        `
        INSERT INTO transactions (id, trip_id, amount, description, photo_url, ocr_text, recorded_at, status)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), 'processed')
      `,
        [
          transactionId,
          trip_id,
          amount,
          description || null,
          photo_url || null,
          ocr_text || null,
        ]
      );

      logger.info(
        {
          transactionId,
          trip_id,
          amount,
          description: description?.substring(0, 50) || 'No description',
        },
        'Transaction created successfully'
      );

      res.status(201).json({
        success: true,
        transaction_id: transactionId,
        trip_id,
        amount: parseFloat(amount),
        message: `Expense of $${amount} recorded successfully`,
      });
    } catch (err) {
      logger.error({ err, reqBody: req.body }, 'Failed to create transaction');
      res.status(500).json({ error: 'Failed to record expense' });
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
      transaction.amount = parseFloat(transaction.amount);

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
  body('amount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Amount must be a positive number'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .trim()
    .withMessage('Description must be less than 1000 characters'),
  body('photo_url')
    .optional()
    .isURL()
    .withMessage('Photo URL must be a valid URL'),
  body('ocr_text')
    .optional()
    .isLength({ max: 5000 })
    .trim()
    .withMessage('OCR text must be less than 5000 characters'),
  body('status')
    .optional()
    .isIn(['pending', 'processed', 'failed'])
    .withMessage('Status must be pending, processed, or failed'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { transaction_id } = req.params;
    const { amount, description, photo_url, ocr_text, status } = req.body;
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
          .json({ error: 'Cannot modify expenses for a completed trip' });
      }

      // Build update query dynamically
      const updates = [];
      const params = [];

      if (amount !== undefined) {
        updates.push('amount = ?');
        params.push(amount);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
      }
      if (photo_url !== undefined) {
        updates.push('photo_url = ?');
        params.push(photo_url);
      }
      if (ocr_text !== undefined) {
        updates.push('ocr_text = ?');
        params.push(ocr_text);
      }
      if (status !== undefined) {
        updates.push('status = ?');
        params.push(status);
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
          .json({ error: 'Cannot delete expenses from a completed trip' });
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
  query('status')
    .optional()
    .isIn(['pending', 'processed', 'failed'])
    .withMessage('Invalid status'),
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

    const { trip_id, status, limit = 20, offset = 0 } = req.query;
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

      if (status) {
        query += ' AND t.status = ?';
        params.push(status);
      }

      query += `
        ORDER BY t.recorded_at DESC
        LIMIT ? OFFSET ?
      `;
      params.push(parseInt(limit), parseInt(offset));

      const [transactions] = await db.execute(query, params);

      // Convert amounts to float
      transactions.forEach(transaction => {
        transaction.amount = parseFloat(transaction.amount);
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
