const express = require('express');
const { body } = require('express-validator');
const { startTimer } = require('../../controllers/start-timer.controller');
const { parseDuration } = require('../../utils/timerHelpers');
const { validate } = require('../../middleware/validator');

const router = express.Router();

/**
 * POST /start-timer
 * Start or restart a 15-minute timer for a specific tripId
 * This endpoint is accessible without authentication for external integrations
 */
router.post(
  '/',
  [
    body('tripId')
      .notEmpty()
      .withMessage('tripId is required')
      .custom(value => {
        if (typeof value !== 'string' && typeof value !== 'number') {
          throw new Error('tripId must be a string or number');
        }
        return true;
      }),
    body('webhookUrl')
      .isURL({
        protocols: ['http', 'https'],
        require_protocol: true,
        require_tld: false, // Allow localhost URLs
      })
      .withMessage('webhookUrl must be a valid HTTP/HTTPS URL'),
    body('phoneNumber')
      .optional()
      .isMobilePhone('any')
      .withMessage('phoneNumber must be a valid mobile phone number'),
    body('duration')
      .optional()
      .custom(value => {
        if (value) {
          try {
            parseDuration(value);
            return true;
          } catch (error) {
            throw new Error(`Invalid duration format: ${error.message}`);
          }
        }
        return true;
      })
      .withMessage('duration must be in format like: 15s, 30m, 2h, 1d'),
  ],
  validate,
  startTimer
);

module.exports = router;
