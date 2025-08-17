const express = require('express');
const { param, query, body } = require('express-validator');
const {
  createTrip,
  stopTrip,
  getTripById,
  getTrips,
  getTripSummary,
} = require('../../controllers/trips.controller');
const { validate } = require('../../middleware/validator');

const router = express.Router();

/**
 * POST /api/trips
 * Create/start a new trip (single active per phoneNumber)
 */
router.post(
  '/',
  [
    body('phoneNumber').isMobilePhone('any').withMessage('Invalid phone number'),
    body('eventName')
      .isLength({ min: 1, max: 255 })
      .trim()
      .withMessage('Event name must be 1-255 characters'),
    body('currency')
      .optional()
      .isIn(['IDR', 'USD'])
      .withMessage('Currency must be IDR or USD'),
  ],
  validate,
  createTrip
);

/**
 * POST /api/trips/:tripId/stop
 * Stop a trip and finalize totals
 */
router.post(
  '/:tripId/stop',
  [
    param('tripId')
      .isString()
      .isLength({ min: 10, max: 12 })
      .withMessage('Invalid trip ID'),
  ],
  validate,
  stopTrip
);

/**
 * GET /api/trips/:tripId
 * Get trip details with transactions
 */
router.get(
  '/:tripId',
  [
    param('tripId')
      .isString()
      .isLength({ min: 10, max: 12 })
      .withMessage('Invalid trip ID'),
  ],
  validate,
  getTripById
);

/**
 * GET /api/trips
 * Get trips for a user with optional filtering
 */
router.get(
  '/',
  [
    query('phoneNumber')
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
  ],
  validate,
  getTrips
);

/**
 * GET /api/trips/:tripId/summary
 * Get trip summary with expense breakdown
 */
router.get(
  '/:tripId/summary',
  [
    param('tripId')
      .isString()
      .isLength({ min: 10, max: 12 })
      .withMessage('Invalid trip ID'),
  ],
  validate,
  getTripSummary
);

module.exports = router;
