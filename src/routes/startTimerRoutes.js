const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const jobManager = require('../utils/jobManager');
const cronJobManager = require('../utils/cronJobs');
const pool = require('../utils/db');
const {
  parseDuration,
  formatDuration,
  formatRelativeTime,
  getTimerStatus,
} = require('../utils/timerHelpers');

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
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn({
        message: 'Timer start request validation failed',
        errors: errors.array(),
        body: req.body,
      });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { tripId, webhookUrl, phoneNumber, duration } = req.body;

    try {
      let senderId = null;
      let senderPhoneNumber = null;

      // Parse duration or use default 15 minutes
      let durationMs;
      try {
        durationMs = duration ? parseDuration(duration) : 15 * 60 * 1000; // Default 15 minutes
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid duration',
          message: error.message,
        });
      }

      // Look up user by phone number if provided
      if (phoneNumber) {
        const connection = await pool.getConnection();
        try {
          const [users] = await connection.execute(
            'SELECT id, phone_number FROM users WHERE phone_number = ?',
            [phoneNumber]
          );

          if (users.length > 0) {
            senderId = users[0].id;
            senderPhoneNumber = users[0].phone_number;
            logger.debug({
              message: 'User found for phone number',
              phoneNumber,
              senderId,
            });
          } else {
            logger.warn({
              message: 'User not found for phone number',
              phoneNumber,
            });
            // Continue without sender ID - we'll still create the timer
          }
        } finally {
          connection.release();
        }
      }

      // Ensure cron job is running
      const cronStatus = cronJobManager.getStatus();
      if (!cronStatus.running) {
        cronJobManager.start();
        logger.info({
          message: 'Cron job started due to timer request',
          tripId,
        });
      }

      // Check if job already exists for this tripId
      const existingJob = await jobManager.getJobByTripId(tripId);
      const isRestart = !!existingJob;

      // Add or update the job (handles restart logic)
      const job = await jobManager.addOrUpdateJob(
        tripId,
        webhookUrl,
        senderId,
        durationMs
      );

      const timeUntilExpiry = job.deadline - Date.now();
      const timerStatus = getTimerStatus(timeUntilExpiry);

      const responseMessage = isRestart
        ? `Timer restarted! Will call webhook in ${formatDuration(timeUntilExpiry)}`
        : `Timer started! Will call webhook in ${formatDuration(timeUntilExpiry)}`;

      logger.info({
        message: isRestart ? 'Timer restarted' : 'Timer started',
        tripId,
        webhookUrl,
        deadline: job.deadline,
        isRestart,
        timeUntilExpiry,
      });

      res.status(200).json({
        success: true,
        tripId: job.tripId,
        webhookUrl: job.webhookUrl,
        senderId: job.senderId,
        phoneNumber: senderPhoneNumber,
        duration: duration || '15m',
        durationMs,
        deadline: job.deadline,
        deadlineISO: new Date(job.deadline).toISOString(),
        timeUntilExpiry,
        timeUntilExpiryFormatted: formatDuration(timeUntilExpiry),
        expiresIn: formatRelativeTime(timeUntilExpiry, false),
        timerStatus: timerStatus.status,
        statusDescription: timerStatus.description,
        isRestart,
        message: responseMessage,
      });
    } catch (error) {
      logger.error({
        message: 'Failed to start/restart timer',
        error: error.message,
        tripId,
        webhookUrl,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to start timer',
      });
    }
  }
);

module.exports = router;
