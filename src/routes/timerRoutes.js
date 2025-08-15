const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const jobManager = require('../utils/jobManager');
const cronJobManager = require('../utils/cronJobs');

const router = express.Router();

// Utility functions for user-friendly time formatting
/**
 * Convert milliseconds to human-readable duration
 * @param {number} milliseconds - Time in milliseconds
 * @returns {string} Human-readable duration like "5 minutes 30 seconds"
 */
function formatDuration(milliseconds) {
  if (milliseconds <= 0) return '0 seconds';

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }
  if (seconds > 0 && hours === 0) {
    // Only show seconds if less than an hour
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  }

  if (parts.length === 0) return '0 seconds';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts.join(' ');

  // For 3 parts (hours, minutes, seconds), join with commas
  return parts.slice(0, -1).join(', ') + ' ' + parts[parts.length - 1];
}

/**
 * Create relative time description
 * @param {number} timeRemaining - Time remaining in milliseconds
 * @param {boolean} isExpired - Whether the timer has expired
 * @returns {string} Relative time description
 */
function formatRelativeTime(timeRemaining, isExpired) {
  if (isExpired) {
    const overdue = Math.abs(timeRemaining);
    return `expired ${formatDuration(overdue)} ago`;
  }

  if (timeRemaining <= 60000) {
    // Less than 1 minute
    const seconds = Math.floor(timeRemaining / 1000);
    return `expires in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  }

  return `expires in ${formatDuration(timeRemaining)}`;
}

/**
 * Get timer status description
 * @param {number} timeRemaining - Time remaining in milliseconds
 * @returns {Object} Status object with description and type
 */
function getTimerStatus(timeRemaining) {
  if (timeRemaining <= 0) {
    return {
      status: 'expired',
      description: 'Timer has expired and webhook should have been called',
      urgency: 'high',
    };
  }

  if (timeRemaining <= 60000) {
    // Less than 1 minute
    return {
      status: 'expiring_soon',
      description: 'Timer will expire very soon',
      urgency: 'high',
    };
  }

  if (timeRemaining <= 300000) {
    // Less than 5 minutes
    return {
      status: 'active_urgent',
      description: 'Timer is active and will expire soon',
      urgency: 'medium',
    };
  }

  return {
    status: 'active',
    description: 'Timer is active and running normally',
    urgency: 'low',
  };
}

/**
 * POST /start-timer
 * Start or restart a 15-minute timer for a specific tripId
 * When timer expires, sends POST request to specified webhook URL
 */
router.post(
  '/start-timer',
  [
    body('tripId')
      .notEmpty()
      .withMessage('tripId is required')
      .custom(value => {
        // Allow both string and number tripIds
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
  ],
  async (req, res) => {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn(
        { errors: errors.array(), reqBody: req.body },
        'Timer start request validation failed'
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const { tripId, webhookUrl } = req.body;

    try {
      // Ensure cron job is running
      const cronStatus = cronJobManager.getStatus();
      if (!cronStatus.running) {
        cronJobManager.start();
        logger.info('Started cron job due to timer request');
      }

      // Check if job already exists for this tripId
      const existingJob = await jobManager.getJobByTripId(tripId);
      const isRestart = !!existingJob;

      // Add or update the job (this handles the restart logic)
      const job = await jobManager.addOrUpdateJob(tripId, webhookUrl);

      const timeUntilExpiry = job.deadline - Date.now();
      const timerStatus = getTimerStatus(timeUntilExpiry);

      const responseMessage = isRestart
        ? `Timer restarted! Will call webhook in 15 minutes (${formatDuration(timeUntilExpiry)})`
        : `Timer started! Will call webhook in 15 minutes (${formatDuration(timeUntilExpiry)})`;

      logger.info(
        {
          tripId,
          webhookUrl,
          deadline: job.deadline,
          isRestart,
          timeUntilExpiry,
        },
        isRestart ? 'Timer restarted' : 'Timer started'
      );

      res.status(200).json({
        success: true,
        tripId: job.tripId,
        webhookUrl: job.webhookUrl,
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
      logger.error(
        { err: error, tripId, webhookUrl },
        'Failed to start/restart timer'
      );

      res.status(500).json({
        success: false,
        error: 'Failed to start timer',
        message:
          'Internal server error occurred while processing timer request',
      });
    }
  }
);

/**
 * GET /timer/status/:tripId
 * Get timer status for a specific tripId
 */
router.get('/status/:tripId', async (req, res) => {
  const { tripId } = req.params;

  try {
    const job = await jobManager.getJobByTripId(tripId);

    if (!job) {
      return res.status(404).json({
        success: false,
        tripId,
        message: 'No timer found for this tripId',
      });
    }

    const now = Date.now();
    const timeRemaining = job.deadline - now;
    const isExpired = timeRemaining <= 0;
    const timerStatus = getTimerStatus(timeRemaining);

    res.status(200).json({
      success: true,
      tripId: job.tripId,
      webhookUrl: job.webhookUrl,
      deadline: job.deadline,
      deadlineISO: new Date(job.deadline).toISOString(),
      timeRemaining: Math.max(0, timeRemaining),
      timeRemainingFormatted: formatDuration(Math.max(0, timeRemaining)),
      timeDescription: formatRelativeTime(timeRemaining, isExpired),
      timerStatus: timerStatus.status,
      statusDescription: timerStatus.description,
      urgency: timerStatus.urgency,
      isExpired,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (error) {
    logger.error({ err: error, tripId }, 'Failed to get timer status');

    res.status(500).json({
      success: false,
      error: 'Failed to get timer status',
    });
  }
});

/**
 * DELETE /timer/:tripId
 * Cancel a timer for a specific tripId
 */
router.delete('/:tripId', async (req, res) => {
  const { tripId } = req.params;

  try {
    const removed = await jobManager.removeJob(tripId);

    if (!removed) {
      return res.status(404).json({
        success: false,
        tripId,
        message: 'No timer found for this tripId',
      });
    }

    logger.info({ tripId }, 'Timer cancelled by user request');

    res.status(200).json({
      success: true,
      tripId,
      message: 'Timer cancelled successfully',
    });
  } catch (error) {
    logger.error({ err: error, tripId }, 'Failed to cancel timer');

    res.status(500).json({
      success: false,
      error: 'Failed to cancel timer',
    });
  }
});

/**
 * GET /timer/list
 * Get all active timers (for debugging/monitoring)
 * This endpoint might be useful for admin purposes
 */
router.get('/list', async (req, res) => {
  try {
    const jobs = await jobManager.getAllJobs();
    const now = Date.now();

    // Enhance job data with calculated fields
    const enhancedJobs = jobs.map(job => {
      const timeRemaining = job.deadline - now;
      const isExpired = timeRemaining <= 0;
      const timerStatus = getTimerStatus(timeRemaining);

      return {
        ...job,
        deadlineISO: new Date(job.deadline).toISOString(),
        timeRemaining: Math.max(0, timeRemaining),
        timeRemainingFormatted: formatDuration(Math.max(0, timeRemaining)),
        timeDescription: formatRelativeTime(timeRemaining, isExpired),
        timerStatus: timerStatus.status,
        statusDescription: timerStatus.description,
        urgency: timerStatus.urgency,
        isExpired,
      };
    });

    // Separate expired and active jobs
    const activeJobs = enhancedJobs.filter(job => !job.isExpired);
    const expiredJobs = enhancedJobs.filter(job => job.isExpired);
    const urgentJobs = activeJobs.filter(
      job => job.urgency === 'high' || job.urgency === 'medium'
    );

    // Find next expiring job
    const nextExpiringJob =
      activeJobs.length > 0
        ? activeJobs.reduce((earliest, job) =>
            job.deadline < earliest.deadline ? job : earliest
          )
        : null;

    res.status(200).json({
      success: true,
      cronJobStatus: cronJobManager.getStatus(),
      summary: {
        total: jobs.length,
        active: activeJobs.length,
        expired: expiredJobs.length,
        urgent: urgentJobs.length,
        nextExpiring: nextExpiringJob
          ? {
              tripId: nextExpiringJob.tripId,
              timeRemaining: nextExpiringJob.timeRemainingFormatted,
              description: nextExpiringJob.timeDescription,
            }
          : null,
      },
      jobs: {
        active: activeJobs,
        expired: expiredJobs,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list timers');

    res.status(500).json({
      success: false,
      error: 'Failed to list timers',
    });
  }
});

/**
 * POST /timer/process-expired
 * Manually trigger processing of expired jobs (for testing/debugging)
 */
router.post('/process-expired', async (req, res) => {
  try {
    logger.info('Manual trigger of expired job processing requested');
    await cronJobManager.triggerManualProcess();

    res.status(200).json({
      success: true,
      message: 'Manual processing of expired jobs completed',
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to manually process expired jobs');

    res.status(500).json({
      success: false,
      error: 'Failed to process expired jobs',
    });
  }
});

module.exports = router;
