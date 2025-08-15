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
   * Initialize and start the cron job
   * Runs every minute to check for expired jobs
   */
  initialize() {
    if (this.isInitialized) {
      logger.warn('Cron job already initialized');
      return;
    }

    // Schedule to run every minute
    this.cronTask = cron.schedule(
      '* * * * *',
      async () => {
        try {
          await this.processExpiredJobs();
        } catch (error) {
          logger.error(
            { err: error },
            'Error processing expired jobs in cron task'
          );
        }
      },
      {
        scheduled: false, // Don't start immediately
      }
    );

    this.isInitialized = true;
    logger.info('Cron job initialized (not started yet)');
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
      logger.info('Timer webhook cron job started - checking every minute');
    } else {
      logger.warn('Cron job is already running or not initialized');
    }
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronTask && this.cronTask.running) {
      this.cronTask.stop();
      logger.info('Timer webhook cron job stopped');
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
        logger.debug('No expired jobs found');
        return;
      }

      logger.info({ count: expiredJobs.length }, 'Processing expired jobs');

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
          {
            total: expiredJobs.length,
            success: successCount,
            failed: failedCount,
          },
          'Some webhook calls failed'
        );
      } else {
        logger.info(
          { total: expiredJobs.length, success: successCount },
          'All webhook calls completed successfully'
        );
      }

      // Remove all processed jobs (both successful and failed)
      const tripIds = expiredJobs.map(job => job.tripId);
      await jobManager.removeJobs(tripIds);
    } catch (error) {
      logger.error({ err: error }, 'Failed to process expired jobs');
    }
  }

  /**
   * Process a single expired job - make webhook call
   * @param {Object} job - Job object with tripId, webhookUrl, deadline
   * @returns {Promise<Object>} Result of webhook call
   */
  async processExpiredJob(job) {
    const { tripId, webhookUrl, deadline } = job;

    try {
      logger.info(
        { tripId, webhookUrl, deadline, delay: Date.now() - deadline },
        'Processing expired job - making webhook call'
      );

      // Prepare webhook payload
      const payload = {
        tripId,
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

      logger.info(
        {
          tripId,
          webhookUrl,
          statusCode: response.status,
          responseTime:
            response.config.metadata?.endTime -
            response.config.metadata?.startTime,
        },
        'Webhook call successful'
      );

      return {
        tripId,
        success: true,
        statusCode: response.status,
        response: response.data,
      };
    } catch (error) {
      // Log different types of errors appropriately
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        logger.error(
          { tripId, webhookUrl, errorCode: error.code },
          'Webhook call failed - network/DNS error'
        );
      } else if (error.response) {
        logger.error(
          {
            tripId,
            webhookUrl,
            statusCode: error.response.status,
            responseData: error.response.data,
          },
          'Webhook call failed - HTTP error response'
        );
      } else if (error.request) {
        logger.error(
          { tripId, webhookUrl, errorMessage: error.message },
          'Webhook call failed - no response received'
        );
      } else {
        logger.error(
          { tripId, webhookUrl, err: error },
          'Webhook call failed - unexpected error'
        );
      }

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
    logger.info('Manual trigger of expired job processing');
    await this.processExpiredJobs();
  }
}

// Export singleton instance
module.exports = new CronJobManager();
