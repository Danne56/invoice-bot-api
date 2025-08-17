const logger = require('../utils/logger');
const jobManager = require('../utils/jobManager');
const cronJobManager = require('../utils/cronJobs');
const pool = require('../utils/db');
const { parseDuration, formatDuration } = require('../utils/timerHelpers');

const startTimer = async (req, res) => {
  const { tripId, webhookUrl, phoneNumber, duration } = req.body;

  try {
    let senderId = null;

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
        } else {
          logger.warn(`User not found for phone number ${phoneNumber}`);
          // Continue without sender ID - we'll still create the timer
        }
      } finally {
        connection.release();
      }
    }

    const cronStatus = cronJobManager.getStatus();
    if (!cronStatus.running) {
      cronJobManager.start();
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

    const responseMessage = isRestart
      ? `Timer restarted! Will expire in ${formatDuration(timeUntilExpiry)}`
      : `Timer started! Will expire in ${formatDuration(timeUntilExpiry)}`;

    logger.info(responseMessage.replace('!', '') + ` for trip ${tripId}`);

    res.status(200).json({
      success: true,
      tripId: job.tripId,
      message: responseMessage,
      expiresIn: formatDuration(timeUntilExpiry),
      expiresAt: new Date(job.deadline).toISOString(),
    });
  } catch (error) {
    logger.error(
      `Failed to start timer for trip ${tripId}: ${error.message}`
    );

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to start timer',
    });
  }
};

module.exports = {
  startTimer,
};
