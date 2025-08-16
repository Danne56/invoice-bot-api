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

      if (expiredJobs.length === 0) {
        return;
      }

      logger.info(`Processing ${expiredJobs.length} expired timer(s)`);

      // Process each expired job
      const results = await Promise.allSettled(
        expiredJobs.map(job => this.processExpiredJob(job))
      );

      // Count successful and failed webhook calls
      const successCount = results.filter(
        result => result.status === 'fulfilled'
      ).length;
      const failedCount = results.length - successCount;

      if (failedCount > 0) {
        logger.warn(
          `${failedCount} of ${expiredJobs.length} timer notifications failed`
        );
      } else {
        logger.info(
          `All ${expiredJobs.length} timer notifications sent successfully`
        );
      }

      // Remove all processed jobs (both successful and failed)
      const tripIds = expiredJobs.map(job => job.tripId);
      await jobManager.removeJobs(tripIds);
    } catch (error) {
      logger.error(`Failed to process expired timers: ${error.message}`);
    }
  }

  /**
   * Process a single expired job - make webhook call
   * @param {Object} job - Job object with tripId, webhookUrl, deadline, phoneNumber
   * @returns {Promise<Object>} Result of webhook call
   */
  async processExpiredJob(job) {
    const { tripId, webhookUrl, deadline, phoneNumber } = job;

    try {
      logger.info(`Sending timer notification for trip ${tripId}`);

      // Prepare webhook payload
      const payload = {
        tripId,
        phoneNumber: phoneNumber || null,
        message: 'Timer selesai',
        timestamp: new Date().toISOString(),
        originalDeadline: new Date(deadline).toISOString(),
      };

      // Make HTTP POST request to webhook
      const response = await axios.post(webhookUrl, payload, {
        timeout: 30000, // 30 second timeout
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Invoice-Bot-Timer-Webhook/1.0',
        },
      });

      logger.info(`Timer notification sent successfully for trip ${tripId}`);

      return {
        tripId,
        success: true,
        statusCode: response.status,
        response: response.data,
      };
    } catch (error) {
      logger.error(
        `Failed to send timer notification for trip ${tripId}: ${error.message}`
      );

      return {
        tripId,
        success: false,
        error: error.message,
        statusCode: error.response?.status,
      };
    }
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
