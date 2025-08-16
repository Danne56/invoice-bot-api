const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const TransactionModel = require('../models/transactionModel');
const logger = require('../utils/logger');
const {
  toMajor,
  isValidAmountByCurrency,
  formatAmountForDisplay,
} = require('../utils/currency');

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn({ errors: errors.array(), reqBody: req.body });
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

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
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const transaction = await TransactionModel.create(req.body);
      const displayAmount = formatAmountForDisplay(
        transaction.currency,
        transaction.total_amount
      );
      const message = `Invoice of ${displayAmount} recorded successfully`;

      logger.info(
        {
          transactionId: transaction.transaction_id,
          trip_id: transaction.trip_id,
          total_amount: transaction.total_amount,
          merchant: transaction.merchant || 'No merchant',
        },
        'Invoice transaction created successfully'
      );

      res.status(201).json({
        success: true,
        transaction_id: transaction.transaction_id,
        trip_id: transaction.trip_id,
        currency: transaction.currency,
        amount: toMajor(transaction.currency, transaction.total_amount),
        display_amount: displayAmount,
        merchant: transaction.merchant || null,
        message,
      });
    } catch (err) {
      if (
        err.message === 'Trip not found' ||
        err.message === 'Cannot add transactions to a completed trip' ||
        err.message.includes('does not match transaction currency')
      ) {
        return res.status(400).json({ error: err.message });
      }
      logger.error({ err, reqBody: req.body }, 'Failed to create transaction');
      next(err);
    }
  }
);

router.get(
  '/:transactionId',
  param('transactionId')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid transaction ID'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { transactionId } = req.params;
      const t = await TransactionModel.findById(transactionId);

      if (!t) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      const currency = t.currency || 'IDR';
      const payload = {
        ...t,
        currency,
        amount: toMajor(currency, t.total_amount || 0),
        display_amount: formatAmountForDisplay(currency, t.total_amount || 0),
      };
      if (t.subtotal !== null) {
        payload.subtotal_amount = toMajor(currency, t.subtotal);
        payload.subtotal_display = formatAmountForDisplay(currency, t.subtotal);
      }
      if (t.tax_amount !== null) {
        payload.tax_amount = toMajor(currency, t.tax_amount);
        payload.tax_display = formatAmountForDisplay(currency, t.tax_amount);
      }

      res.status(200).json({ data: payload });
    } catch (err) {
      logger.error(
        { err, transaction_id: req.params.transactionId },
        'Failed to fetch transaction'
      );
      next(err);
    }
  }
);

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
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const transactions = await TransactionModel.findAll(req.query);

      const data = transactions.map(t => {
        const currency = t.currency || 'IDR';
        const row = {
          ...t,
          currency,
          amount: toMajor(currency, t.total_amount || 0),
          display_amount: formatAmountForDisplay(
            currency,
            t.total_amount || 0
          ),
        };
        if (t.subtotal !== null) {
          row.subtotal_amount = toMajor(currency, t.subtotal);
          row.subtotal_display = formatAmountForDisplay(currency, t.subtotal);
        }
        if (t.tax_amount !== null) {
          row.tax_amount = toMajor(currency, t.tax_amount);
          row.tax_display = formatAmountForDisplay(currency, t.tax_amount);
        }
        return row;
      });

      res.status(200).json({
        data,
        pagination: {
          limit: parseInt(req.query.limit || 20, 10),
          offset: parseInt(req.query.offset || 0, 10),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch transactions');
      next(err);
    }
  }
);

module.exports = router;
