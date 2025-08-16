const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const jobManager = require('../utils/jobManager');
const cronJobManager = require('../utils/cronJobs');
const UserModel = require('../models/userModel');
const { parseDuration, formatDuration } = require('../utils/timerHelpers');

const router = express.Router();

const validate = [
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
      require_tld: false,
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
        parseDuration(value);
      }
      return true;
    })
    .withMessage('duration must be in format like: 15s, 30m, 2h, 1d'),
];

router.post('/', validate, async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(
      `Timer validation failed for trip ${req.body.tripId || 'unknown'}`
    );
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
  }

  const { tripId, webhookUrl, phoneNumber, duration } = req.body;

  try {
    let senderId = null;
    if (phoneNumber) {
      const user = await UserModel.findUserByPhoneNumber(phoneNumber);
      if (user) {
        senderId = user.id;
      } else {
        logger.warn(`User not found for phone number ${phoneNumber}`);
      }
    }

    const durationMs = duration ? parseDuration(duration) : 15 * 60 * 1000;

    if (!cronJobManager.getStatus().running) {
      cronJobManager.start();
    }

    const existingJob = await jobManager.getJobByTripId(tripId);
    const job = await jobManager.addOrUpdateJob(
      tripId,
      webhookUrl,
      senderId,
      durationMs
    );
    const timeUntilExpiry = job.deadline - Date.now();
    const isRestart = !!existingJob;

    const responseMessage = `${
      isRestart ? 'Timer restarted' : 'Timer started'
    }! Will expire in ${formatDuration(timeUntilExpiry)}`;

    logger.info(`${responseMessage.replace('!', '')} for trip ${tripId}`);

    res.status(200).json({
      success: true,
      tripId: job.tripId,
      message: responseMessage,
      expiresIn: formatDuration(timeUntilExpiry),
      expiresAt: new Date(job.deadline).toISOString(),
    });
  } catch (error) {
    logger.error(`Failed to start timer for trip ${tripId}: ${error.message}`);
    next(error);
  }
});

module.exports = router;
