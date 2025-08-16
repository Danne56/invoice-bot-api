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
          logger.error({
            message: 'Error processing expired jobs in cron task',
            error: error.message,
          });
        }
      },
      {
        scheduled: false, // Don't start immediately
      }
    );

    this.isInitialized = true;
    logger.info({
      message: 'Cron job initialized successfully (not started yet)',
    });
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
      logger.info({
        message: 'Timer webhook cron job started - checking every minute',
      });
    } else {
      logger.warn({
        message: 'Cron job is already running or not initialized',
        isRunning: this.cronTask ? this.cronTask.running : false,
        isInitialized: this.isInitialized,
      });
    }
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronTask && this.cronTask.running) {
      this.cronTask.stop();
      logger.info({
        message: 'Timer webhook cron job stopped',
      });
    } else {
      logger.warn({
        message: 'Cron job is not running or not initialized',
        isRunning: this.cronTask ? this.cronTask.running : false,
        isInitialized: this.isInitialized,
      });
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
        logger.debug({
          message: 'No expired jobs found',
        });
        return;
      }

      logger.info({
        message: 'Processing expired jobs',
        count: expiredJobs.length,
      });

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
        logger.warn({
          message: 'Some webhook calls failed',
          total: expiredJobs.length,
          success: successCount,
          failed: failedCount,
        });
      } else {
        logger.info({
          message: 'All webhook calls completed successfully',
          total: expiredJobs.length,
          success: successCount,
        });
      }

      // Remove all processed jobs (both successful and failed)
      const tripIds = expiredJobs.map(job => job.tripId);
      await jobManager.removeJobs(tripIds);
    } catch (error) {
      logger.error({
        message: 'Failed to process expired jobs',
        error: error.message,
      });
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
      const delay = Date.now() - deadline;

      logger.info({
        message: 'Processing expired job - making webhook call',
        tripId,
        webhookUrl,
        deadline,
        delay,
      });

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

      logger.info({
        message: 'Webhook call successful',
        tripId,
        webhookUrl,
        statusCode: response.status,
        responseSize: response.data ? JSON.stringify(response.data).length : 0,
      });

      return {
        tripId,
        success: true,
        statusCode: response.status,
        response: response.data,
      };
    } catch (error) {
      // Log different types of errors appropriately
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        logger.error({
          message: 'Webhook call failed - network/DNS error',
          tripId,
          webhookUrl,
          errorCode: error.code,
        });
      } else if (error.response) {
        logger.error({
          message: 'Webhook call failed - HTTP error response',
          tripId,
          webhookUrl,
          statusCode: error.response.status,
          responseData: error.response.data,
        });
      } else if (error.request) {
        logger.error({
          message: 'Webhook call failed - no response received',
          tripId,
          webhookUrl,
          errorMessage: error.message,
        });
      } else {
        logger.error({
          message: 'Webhook call failed - unexpected error',
          tripId,
          webhookUrl,
          error: error.message,
        });
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
    logger.info({
      message: 'Manual processing of expired jobs triggered',
    });

    await this.processExpiredJobs();

    logger.info({
      message: 'Manual processing of expired jobs completed',
    });
  }
}

// Export singleton instance
module.exports = new CronJobManager();
