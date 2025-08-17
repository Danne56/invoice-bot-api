const express = require('express');
const { body, param, query } = require('express-validator');
const {
  createTransaction,
  getTransactionById,
  getTransactions,
} = require('../controllers/transactions.controller');
const { validate } = require('../middleware/validator');

const router = express.Router();

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

/**
 * POST /api/transactions
 * Create a new invoice/receipt transaction
 */
router.post(
  '/',
  [
    body('tripId')
      .isString()
      .isLength({ min: 10, max: 12 })
      .withMessage('Invalid trip ID'),
    body('currency')
      .optional()
      .isIn(['IDR', 'USD'])
      .withMessage('Currency must be IDR or USD'),
    body('totalAmount').custom((value, { req }) => {
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
    body('taxAmount')
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
    body('itemCount')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Item count must be a positive integer'),
    body('itemSummary')
      .optional()
      .isLength({ max: 5000 })
      .trim()
      .withMessage('Item summary must be less than 5000 characters'),
  ],
  validate,
  createTransaction
);

/**
 * GET /api/transactions/:transactionId
 * Get transaction details
 */
router.get(
  '/:transactionId',
  [
    param('transactionId')
      .isString()
      .isLength({ min: 10, max: 12 })
      .withMessage('Invalid transaction ID'),
  ],
  validate,
  getTransactionById
);

/**
 * GET /api/transactions
 * Get transactions with filtering options
 */
router.get(
  '/',
  [
    query('tripId')
      .optional()
      .isString()
      .isLength({ min: 10, max: 12 })
      .withMessage('Invalid trip ID'),
    query('merchant')
      .optional()
      .isLength({ max: 100 })
      .trim()
      .withMessage('Merchant filter must be less than 100 characters'),
    query('dateFrom')
      .optional()
      .isISO8601()
      .withMessage('Date from must be in ISO 8601 format (YYYY-MM-DD)'),
    query('dateTo')
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
  ],
  validate,
  getTransactions
);

module.exports = router;
