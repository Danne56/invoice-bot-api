const cron = require('node-cron');
const axios = require('axios');
const logger = require('./logger');
const jobManager = require('./jobManager');

/**
 * Cron Job Manager for handling timer-based webhook execution
 * Runs every minute to check for expired timers and make webhook calls
 */
class CronJobManager {
  constructor() {
    this.isInitialized = false;
    this.cronTask = null;
  }

  /**
   * Initialize the cron job (runs every minute)
   */
  initialize() {
    if (this.isInitialized) {
      logger.warn({
        message: 'Cron job already initialized',
      });
      return;
    }

    // Schedule to run every minute
    this.cronTask = cron.schedule(
      '* * * * *',
      async () => {
        try {
          await this.processExpiredJobs();
        } catch (error) {
          logger.error(`Timer system error: ${error.message}`);
        }
      },
      {
        scheduled: false, // Don't start immediately
      }
    );

    this.isInitialized = true;
    logger.info('Timer system initialized');
  }

  /**
   * Start the cron job
   */
  start() {
    if (!this.isInitialized) {
      this.initialize();
    }

    if (this.cronTask && !this.cronTask.running) {
      this.cronTask.start();
      logger.info('Timer system started');
    }
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronTask && this.cronTask.running) {
      this.cronTask.stop();
      logger.info('Timer system stopped');
    }
  }

  /**
   * Get cron job status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      running: this.cronTask ? this.cronTask.running : false,
    };
  }

  /**
   * Process all expired jobs - check deadlines and make webhook calls
   */
  async processExpiredJobs() {
    try {
      const expiredJobs = await jobManager.getExpiredJobs();
      const pendingRetries = await jobManager.getPendingRetries();

      const allJobs = [...expiredJobs, ...pendingRetries];

      if (allJobs.length === 0) {
        return;
      }

      // Log based on job types and count
      if (expiredJobs.length > 0 && pendingRetries.length > 0) {
        logger.info(
          `Processing ${expiredJobs.length} expired timers and ${pendingRetries.length} pending retries`
        );
      } else if (expiredJobs.length === 1 && pendingRetries.length === 0) {
        logger.info(
          `Timer expired for trip ${expiredJobs[0].tripId}, sending notification`
        );
      } else if (expiredJobs.length > 1 && pendingRetries.length === 0) {
        logger.info(`Processing ${expiredJobs.length} expired timers`);
      } else if (pendingRetries.length === 1 && expiredJobs.length === 0) {
        logger.info(
          `Retrying timer notification for trip ${pendingRetries[0].tripId}`
        );
      } else if (pendingRetries.length > 1 && expiredJobs.length === 0) {
        logger.info(`Processing ${pendingRetries.length} timer retries`);
      }

      // Process all jobs (both expired and retries)
      const results = await Promise.allSettled(
        allJobs.map(job => this.processExpiredJob(job))
      );

      // Separate successful and failed results
      const successfulJobs = [];
      const failedJobs = [];

      results.forEach((result, index) => {
        const job = allJobs[index];
        if (result.status === 'fulfilled' && result.value.success) {
          successfulJobs.push(job);
        } else {
          failedJobs.push(job);
        }
      });

      // Handle successful jobs - mark as completed
      if (successfulJobs.length > 0) {
        const successfulTripIds = successfulJobs.map(job => job.tripId);
        await jobManager.markJobsCompleted(successfulTripIds);

        if (successfulJobs.length === 1) {
          logger.info(
            `Timer notification sent successfully for trip ${successfulJobs[0].tripId}`
          );
        } else {
          logger.info(
            `${successfulJobs.length} timer notifications sent successfully`
          );
        }
      }

      // Handle failed jobs - schedule retries or mark as expired
      if (failedJobs.length > 0) {
        for (const job of failedJobs) {
          const currentRetryCount = job.retryCount || 0;
          await jobManager.scheduleRetry(job.tripId, currentRetryCount);
        }

        logger.warn(
          `${failedJobs.length} timer notifications failed, scheduled for retry`
        );
      }
    } catch (error) {
      logger.error(`Failed to process expired timers: ${error.message}`);
    }
  }

  /**
   * Process a single expired job - make webhook call
   * @param {Object} job - Job object with tripId, webhookUrl, deadline, phoneNumber, retryCount
   * @returns {Promise<Object>} Result of webhook call
   */
  async processExpiredJob(job) {
    const { tripId, webhookUrl, deadline, phoneNumber, retryCount = 0 } = job;

    try {
      // Prepare webhook payload
      const payload = {
        tripId,
        phoneNumber: phoneNumber || null,
        message: 'Timer selesai',
        timestamp: new Date().toISOString(),
        originalDeadline: new Date(deadline).toISOString(),
        retryCount,
        isRetry: retryCount > 0,
      };

      // Make HTTP POST request to webhook
      const response = await axios.post(webhookUrl, payload, {
        timeout: 30000, // 30 second timeout
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Invoice-Bot-Timer-Webhook/1.0',
        },
      });

      // Check if response indicates success
      const isSuccess = response.status >= 200 && response.status < 300;

      return {
        tripId,
        success: isSuccess,
        statusCode: response.status,
        response: response.data,
        retryCount,
      };
    } catch (error) {
      // Determine if error is retryable
      const isRetryableError = this.isRetryableError(error);

      logger.error(
        `Failed to send timer notification for trip ${tripId} (attempt ${retryCount + 1}): ${error.message}`
      );

      return {
        tripId,
        success: false,
        error: error.message,
        statusCode: error.response?.status,
        retryCount,
        isRetryable: isRetryableError,
      };
    }
  }

  /**
   * Determine if an error is retryable
   * @param {Error} error - The error object
   * @returns {boolean} True if error should be retried
   */
  isRetryableError(error) {
    // Network errors, timeouts, and 5xx server errors are retryable
    if (
      error.code === 'ECONNRESET' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'TIMEOUT'
    ) {
      return true;
    }

    // 5xx server errors are retryable
    if (error.response && error.response.status >= 500) {
      return true;
    }

    // 4xx client errors (except 408, 429) are not retryable
    if (
      error.response &&
      error.response.status >= 400 &&
      error.response.status < 500
    ) {
      // 408 Request Timeout and 429 Too Many Requests are retryable
      return error.response.status === 408 || error.response.status === 429;
    }

    return true; // Default to retryable for unknown errors
  }

  /**
   * Manually trigger processing of expired jobs (for testing/debugging)
   */
  async triggerManualProcess() {
    logger.info('Manual timer check triggered');
    await this.processExpiredJobs();
  }
}

// Export singleton instance
module.exports = new CronJobManager();
