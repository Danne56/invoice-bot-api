const logger = require('../utils/logger');
const jobManager = require('../utils/jobManager');
const cronJobManager = require('../utils/cronJobs');
const {
  formatDuration,
  formatRelativeTime,
  getTimerStatus,
  calculateTimerStats,
} = require('../utils/timerHelpers');

const getTimerStatusByTripId = async (req, res) => {
  const { tripId } = req.params;

  try {
    const job = await jobManager.getJobByTripId(tripId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Timer not found',
        message: `No timer found for tripId: ${tripId}`,
      });
    }

    const now = Date.now();
    const timeRemaining = job.deadline - now;
    const isExpired = timeRemaining <= 0;
    const timerStatus = getTimerStatus(timeRemaining);

    logger.info({
      message: 'Timer status retrieved',
      tripId,
      timerStatus: timerStatus.status,
      timeRemaining: Math.max(0, timeRemaining),
    });

    res.status(200).json({
      success: true,
      tripId: job.tripId,
      webhookUrl: job.webhookUrl,
      senderId: job.senderId,
      phoneNumber: job.phoneNumber,
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
    logger.error({
      message: 'Failed to get timer status',
      error: error.message,
      tripId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve timer status',
    });
  }
};

const cancelTimer = async (req, res) => {
  const { tripId } = req.params;

  try {
    const removed = await jobManager.removeJob(tripId);

    if (!removed) {
      return res.status(404).json({
        success: false,
        error: 'Timer not found',
        message: `No timer found for tripId: ${tripId}`,
      });
    }

    logger.info({
      message: 'Timer cancelled successfully',
      tripId,
    });

    res.status(200).json({
      success: true,
      tripId,
      message: 'Timer cancelled successfully',
    });
  } catch (error) {
    logger.error({
      message: 'Failed to cancel timer',
      error: error.message,
      tripId,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to cancel timer',
    });
  }
};

const listTimers = async (req, res) => {
  try {
    const jobs = await jobManager.getAllJobs();
    const cronStatus = cronJobManager.getStatus();

    // Calculate statistics using helper function
    const stats = calculateTimerStats(jobs);

    logger.info({
      message: 'Timer list retrieved',
      totalTimers: stats.summary.total,
      activeTimers: stats.summary.active,
      expiredTimers: stats.summary.expired,
    });

    res.status(200).json({
      success: true,
      cronJobStatus: cronStatus,
      summary: stats.summary,
      jobs: stats.jobs,
    });
  } catch (error) {
    logger.error({
      message: 'Failed to list timers',
      error: error.message,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve timer list',
    });
  }
};

const processExpiredTimers = async (req, res) => {
  try {
    logger.info({
      message: 'Manual processing of expired jobs triggered',
    });

    await cronJobManager.triggerManualProcess();

    logger.info({
      message: 'Manual processing of expired jobs completed successfully',
    });

    res.status(200).json({
      success: true,
      message: 'Manual processing of expired jobs completed',
    });
  } catch (error) {
    logger.error({
      message: 'Failed to manually process expired jobs',
      error: error.message,
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to process expired jobs',
    });
  }
};

module.exports = {
  getTimerStatusByTripId,
  cancelTimer,
  listTimers,
  processExpiredTimers,
};
