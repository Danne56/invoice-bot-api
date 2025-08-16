const express = require('express');
const { param, query, body, validationResult } = require('express-validator');
const TripModel = require('../models/tripModel');
const logger = require('../utils/logger');
const { formatAmountForDisplay, toMajor } = require('../utils/currency');

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
  body('phone_number').isMobilePhone('any').withMessage('Invalid phone number'),
  body('event_name')
    .isLength({ min: 1, max: 255 })
    .trim()
    .withMessage('Event name must be 1-255 characters'),
  body('currency')
    .optional()
    .isIn(['IDR', 'USD'])
    .withMessage('Currency must be IDR or USD'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { phone_number, event_name, currency } = req.body;

      const activeTrip = await TripModel.findActiveByPhoneNumber(phone_number);
      if (activeTrip) {
        return res.status(400).json({
          error: 'Active trip already exists',
          active_trip_id: activeTrip.id,
        });
      }

      const newTrip = await TripModel.create(
        phone_number,
        event_name,
        currency
      );
      logger.info({ ...newTrip }, 'Trip started');
      res.status(201).json({
        success: true,
        ...newTrip,
        message: `Trip '${newTrip.event_name}' started (currency: ${newTrip.currency})`,
      });
    } catch (err) {
      if (err.message === 'User not found') {
        return res.status(404).json({
          error: 'User not found',
          message: 'User must be created first before starting a trip',
        });
      }
      logger.error({ err, reqBody: req.body }, 'Failed to start trip');
      next(err);
    }
  }
);

router.post(
  '/:tripId/stop',
  param('tripId')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const stoppedTrip = await TripModel.stop(tripId);
      const currency = stoppedTrip.currency || 'IDR';
      const displayAmount = formatAmountForDisplay(
        currency,
        stoppedTrip.total_amount
      );

      logger.info(
        {
          trip_id: stoppedTrip.id,
          totalMinor: stoppedTrip.total_amount,
          currency,
        },
        'Trip stopped'
      );
      res.status(200).json({
        success: true,
        trip_id: stoppedTrip.id,
        event_name: stoppedTrip.event_name,
        currency,
        amount: toMajor(currency, stoppedTrip.total_amount),
        display_amount: displayAmount,
        message: `Trip '${stoppedTrip.event_name}' completed with total expense: ${displayAmount}`,
      });
    } catch (err) {
      if (err.message === 'Trip not found') {
        return res.status(404).json({ error: 'Trip not found' });
      }
      if (err.message === 'Trip already completed') {
        return res.status(400).json({ error: 'Trip already completed' });
      }
      logger.error({ err, trip_id: req.params.tripId }, 'Failed to stop trip');
      next(err);
    }
  }
);

router.get(
  '/:tripId',
  param('tripId')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const trip = await TripModel.findById(tripId);

      if (!trip) {
        return res.status(404).json({ error: 'Trip not found' });
      }

      const tripCurrency = trip.currency || 'IDR';
      trip.amount = toMajor(tripCurrency, trip.total_amount || 0);
      trip.display_amount = formatAmountForDisplay(
        tripCurrency,
        trip.total_amount || 0
      );

      trip.transactions = trip.transactions.map(t => {
        const currency = t.currency || tripCurrency;
        const formatted = {
          ...t,
          currency,
          amount: toMajor(currency, t.total_amount || 0),
          display_amount: formatAmountForDisplay(
            currency,
            t.total_amount || 0
          ),
        };
        if (t.subtotal !== null) {
          formatted.subtotal_amount = toMajor(currency, t.subtotal);
          formatted.subtotal_display = formatAmountForDisplay(
            currency,
            t.subtotal
          );
        }
        if (t.tax_amount !== null) {
          formatted.tax_amount = toMajor(currency, t.tax_amount);
          formatted.tax_display = formatAmountForDisplay(
            currency,
            t.tax_amount
          );
        }
        return formatted;
      });

      res.status(200).json({ data: trip });
    } catch (err) {
      logger.error({ err, trip_id: req.params.tripId }, 'Failed to fetch trip');
      next(err);
    }
  }
);

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
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { phone_number, status, limit, offset } = req.query;
      const trips = await TripModel.findAllByUser(phone_number, {
        status,
        limit,
        offset,
      });

      const data = trips.map(trip => {
        const currency = trip.currency || 'IDR';
        return {
          ...trip,
          amount: toMajor(currency, trip.total_amount || 0),
          display_amount: formatAmountForDisplay(
            currency,
            trip.total_amount || 0
          ),
          transaction_count: parseInt(trip.transaction_count, 10),
        };
      });

      res.status(200).json({
        data,
        pagination: {
          limit: parseInt(limit || 10, 10),
          offset: parseInt(offset || 0, 10),
        },
      });
    } catch (err) {
      logger.error(
        { err, phone_number: req.query.phone_number },
        'Failed to fetch trips'
      );
      next(err);
    }
  }
);

router.get(
  '/:tripId/summary',
  param('tripId')
    .isString()
    .isLength({ min: 10, max: 12 })
    .withMessage('Invalid trip ID'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const summary = await TripModel.getSummary(tripId);

      if (!summary) {
        return res.status(404).json({ error: 'Trip not found' });
      }

      const { trip_info, expense_summary, distinct_currencies } = summary;
      const tripCurrency = trip_info.currency || 'IDR';

      if (
        distinct_currencies.length > 1 ||
        (distinct_currencies.length === 1 &&
          distinct_currencies[0] !== tripCurrency)
      ) {
        return res.status(400).json({
          error:
            'Mixed currencies detected in this trip. Single-currency per trip is enforced.',
          details: {
            currencies: distinct_currencies,
            trip_currency: tripCurrency,
          },
        });
      }

      res.status(200).json({
        trip_info: {
          ...trip_info,
          recorded_total_amount: toMajor(tripCurrency, trip_info.total_amount),
          recorded_total_display: formatAmountForDisplay(
            tripCurrency,
            trip_info.total_amount
          ),
        },
        expense_summary: {
          total_transactions: parseInt(expense_summary.total_transactions, 10),
          calculated_total_amount: toMajor(
            tripCurrency,
            expense_summary.calculated_total
          ),
          calculated_total_display: formatAmountForDisplay(
            tripCurrency,
            expense_summary.calculated_total
          ),
          average_expense_amount: toMajor(
            tripCurrency,
            expense_summary.average_expense || 0
          ),
          average_expense_display: formatAmountForDisplay(
            tripCurrency,
            expense_summary.average_expense || 0
          ),
          min_expense_amount: toMajor(
            tripCurrency,
            expense_summary.min_expense || 0
          ),
          min_expense_display: formatAmountForDisplay(
            tripCurrency,
            expense_summary.min_expense || 0
          ),
          max_expense_amount: toMajor(
            tripCurrency,
            expense_summary.max_expense || 0
          ),
          max_expense_display: formatAmountForDisplay(
            tripCurrency,
            expense_summary.max_expense || 0
          ),
          transactions_with_merchant: parseInt(
            expense_summary.transactions_with_merchant,
            10
          ),
        },
      });
    } catch (err) {
      logger.error(
        { err, trip_id: req.params.tripId },
        'Failed to fetch trip summary'
      );
      next(err);
    }
  }
);

module.exports = router;
