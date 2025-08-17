const pool = require('./db');
const logger = require('./logger');
const { generateId } = require('./idGenerator');

/**
 * Job Manager for handling timer-based webhook jobs
 * Manages persistence of job data in database webhook_timers table
 */
class JobManager {
  constructor() {
    // Table should be created via database-setup.sql
  }

  /**
   * Read all active jobs from database
   * @returns {Promise<Array>} Array of job objects
   */
  async readJobs() {
    let connection;
    try {
      connection = await pool.getConnection();

      const [rows] = await connection.execute(`
        SELECT wt.id, wt.trip_id as tripId, wt.webhook_url as webhookUrl,
               wt.sender_id as senderId, wt.deadline_timestamp as deadline,
               wt.status, wt.created_at as createdAt, wt.updated_at as updatedAt,
               u.phone_number as phoneNumber
        FROM webhook_timers wt
        LEFT JOIN users u ON wt.sender_id = u.id
        WHERE wt.status = 'active'
        ORDER BY wt.deadline_timestamp ASC
      `);

      const jobs = rows.map(row => ({
        ...row,
        deadline: parseInt(row.deadline),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));

      return jobs;
    } catch (error) {
      logger.error(`Failed to read timer jobs: ${error.message}`);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Add or update a job for a tripId
   * If tripId already exists, updates the deadline (timer restart)
   * @param {string|number} tripId - Trip identifier
   * @param {string} webhookUrl - Webhook URL to call when timer expires
   * @param {string|null} senderId - User ID who created the timer
   * @param {number} durationMs - Duration in milliseconds (default: 15 minutes)
   * @returns {Promise<Object>} Job object that was added/updated
   */
  async addOrUpdateJob(
    tripId,
    webhookUrl,
    senderId = null,
    durationMs = 15 * 60 * 1000
  ) {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const deadline = Date.now() + durationMs; // Use provided duration
      const tripIdStr = tripId.toString();

      // Check if job already exists
      const [existing] = await connection.execute(
        `SELECT id, created_at, sender_id FROM webhook_timers WHERE trip_id = ? AND status = 'active'`,
        [tripIdStr]
      );

      let jobData;

      if (existing.length > 0) {
        // Update existing job (timer restart)
        await connection.execute(
          `
          UPDATE webhook_timers
          SET webhook_url = ?, sender_id = ?, deadline_timestamp = ?, updated_at = NOW()
          WHERE trip_id = ? AND status = 'active'
        `,
          [webhookUrl, senderId, deadline, tripIdStr]
        );

        jobData = {
          id: existing[0].id,
          tripId: tripIdStr,
          webhookUrl,
          senderId,
          deadline,
          status: 'active',
          createdAt: existing[0].created_at.toISOString(),
          updatedAt: new Date().toISOString(),
        };

        logger.info(`Timer restarted for trip ${tripIdStr}`);
      } else {
        // Create new job
        const jobId = generateId(12);
        const now = new Date();

        await connection.execute(
          `
          INSERT INTO webhook_timers
          (id, trip_id, webhook_url, sender_id, deadline_timestamp, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'active', NOW(), NOW())
        `,
          [jobId, tripIdStr, webhookUrl, senderId, deadline]
        );

        jobData = {
          id: jobId,
          tripId: tripIdStr,
          webhookUrl,
          senderId,
          deadline,
          status: 'active',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };

        logger.info(`Timer started for trip ${tripIdStr}`);
      }

      await connection.commit();
      return jobData;
    } catch (error) {
      if (connection) await connection.rollback();
      logger.error(
        `Failed to create timer for trip ${tripId}: ${error.message}`
      );
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Remove a job by tripId
   * @param {string|number} tripId - Trip identifier
   * @returns {Promise<boolean>} True if job was found and removed
   */
  async removeJob(tripId) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [result] = await connection.execute(
        `DELETE FROM webhook_timers WHERE trip_id = ? AND status = 'active'`,
        [tripId.toString()]
      );

      const removed = result.affectedRows > 0;

      if (removed) {
        logger.info(`Timer cancelled for trip ${tripId}`);
      }

      return removed;
    } catch (error) {
      logger.error(
        `Failed to cancel timer for trip ${tripId}: ${error.message}`
      );
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Get all jobs that have expired (deadline passed)
   * @returns {Promise<Array>} Array of expired job objects
   */
  async getExpiredJobs() {
    let connection;
    try {
      connection = await pool.getConnection();
      const now = Date.now();

      const [rows] = await connection.execute(
        `
        SELECT wt.id, wt.trip_id as tripId, wt.webhook_url as webhookUrl,
               wt.sender_id as senderId, wt.deadline_timestamp as deadline,
               wt.status, wt.created_at as createdAt, wt.updated_at as updatedAt,
               u.phone_number as phoneNumber
        FROM webhook_timers wt
        LEFT JOIN users u ON wt.sender_id = u.id
        WHERE wt.status = 'active' AND wt.deadline_timestamp <= ?
        ORDER BY wt.deadline_timestamp ASC
      `,
        [now]
      );

      const expiredJobs = rows.map(row => ({
        ...row,
        deadline: parseInt(row.deadline),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));

      return expiredJobs;
    } catch (error) {
      logger.error(`Failed to check for expired timers: ${error.message}`);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Mark jobs as completed (only for successful deliveries)
   * @param {Array} tripIds - Array of trip identifiers
   * @returns {Promise<number>} Number of jobs marked as completed
   */
  async markJobsCompleted(tripIds) {
    if (tripIds.length === 0) return 0;

    let connection;
    try {
      connection = await pool.getConnection();

      const tripIdStrings = tripIds.map(id => id.toString());
      const placeholders = tripIdStrings.map(() => '?').join(',');

      const [result] = await connection.execute(
        `UPDATE webhook_timers SET status = 'completed', updated_at = NOW()
         WHERE trip_id IN (${placeholders}) AND status IN ('active', 'pending_retry')`,
        tripIdStrings
      );

      const completedCount = result.affectedRows;

      if (completedCount > 0) {
        logger.info(`${completedCount} timers completed successfully`);
      }

      return completedCount;
    } catch (error) {
      logger.error(`Failed to mark timers as completed: ${error.message}`);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Remove jobs by tripIds (legacy method - now marks as completed)
   * @param {Array} tripIds - Array of trip identifiers
   * @returns {Promise<number>} Number of jobs removed
   */
  async removeJobs(tripIds) {
    return await this.markJobsCompleted(tripIds);
  }

  /**
   * Get all active jobs (for debugging/monitoring)
   * @returns {Promise<Array>} Array of all active job objects
   */
  async getAllJobs() {
    try {
      return await this.readJobs();
    } catch (error) {
      logger.error(`Failed to get timer jobs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get job by tripId
   * @param {string|number} tripId - Trip identifier
   * @returns {Promise<Object|null>} Job object or null if not found
   */
  async getJobByTripId(tripId) {
    let connection;
    try {
      connection = await pool.getConnection();

      const [rows] = await connection.execute(
        `
        SELECT wt.id, wt.trip_id as tripId, wt.webhook_url as webhookUrl,
               wt.sender_id as senderId, wt.deadline_timestamp as deadline,
               wt.status, wt.created_at as createdAt, wt.updated_at as updatedAt,
               u.phone_number as phoneNumber
        FROM webhook_timers wt
        LEFT JOIN users u ON wt.sender_id = u.id
        WHERE wt.trip_id = ? AND wt.status = 'active'
        LIMIT 1
      `,
        [tripId.toString()]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      const job = {
        ...row,
        deadline: parseInt(row.deadline),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };

      return job;
    } catch (error) {
      logger.error(`Failed to get timer for trip ${tripId}: ${error.message}`);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Schedule a job for retry with exponential backoff
   * @param {string} tripId - Trip identifier
   * @param {number} retryCount - Current retry count (0-based)
   * @returns {Promise<boolean>} True if retry was scheduled
   */
  async scheduleRetry(tripId, retryCount = 0) {
    let connection;
    try {
      connection = await pool.getConnection();

      // Calculate next retry time with exponential backoff
      // 1 min, 5 min, 15 min
      const retryDelays = [1 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
      const maxRetries = 3;

      if (retryCount >= maxRetries) {
        // Mark as expired if max retries exceeded
        await connection.execute(
          `UPDATE webhook_timers SET status = 'expired', updated_at = NOW()
           WHERE trip_id = ? AND status IN ('active', 'pending_retry')`,
          [tripId.toString()]
        );

        logger.warn(
          `Timer for trip ${tripId} expired after ${maxRetries} retry attempts`
        );
        return false;
      }

      const nextRetryDelay =
        retryDelays[retryCount] || retryDelays[retryDelays.length - 1];
      const nextRetryAt = new Date(Date.now() + nextRetryDelay);

      const [result] = await connection.execute(
        `UPDATE webhook_timers
         SET status = 'pending_retry',
             retry_count = ?,
             last_retry_at = NOW(),
             next_retry_at = ?,
             updated_at = NOW()
         WHERE trip_id = ? AND status IN ('active', 'pending_retry')`,
        [retryCount + 1, nextRetryAt, tripId.toString()]
      );

      const scheduled = result.affectedRows > 0;

      if (scheduled) {
        logger.info(
          `Timer for trip ${tripId} scheduled for retry ${retryCount + 1}/${maxRetries} at ${nextRetryAt.toISOString()}`
        );
      }

      return scheduled;
    } catch (error) {
      logger.error(
        `Failed to schedule retry for trip ${tripId}: ${error.message}`
      );
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Get jobs that are ready for retry
   * @returns {Promise<Array>} Array of job objects ready for retry
   */
  async getPendingRetries() {
    let connection;
    try {
      connection = await pool.getConnection();
      const now = new Date();

      const [rows] = await connection.execute(
        `
        SELECT wt.id, wt.trip_id as tripId, wt.webhook_url as webhookUrl,
               wt.sender_id as senderId, wt.deadline_timestamp as deadline,
               wt.status, wt.retry_count as retryCount, wt.max_retries as maxRetries,
               wt.last_retry_at as lastRetryAt, wt.next_retry_at as nextRetryAt,
               wt.created_at as createdAt, wt.updated_at as updatedAt,
               u.phone_number as phoneNumber
        FROM webhook_timers wt
        LEFT JOIN users u ON wt.sender_id = u.id
        WHERE wt.status = 'pending_retry' AND wt.next_retry_at <= ?
        ORDER BY wt.next_retry_at ASC
      `,
        [now]
      );

      const retryJobs = rows.map(row => ({
        ...row,
        deadline: parseInt(row.deadline),
        retryCount: parseInt(row.retryCount),
        maxRetries: parseInt(row.maxRetries),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        lastRetryAt: row.lastRetryAt ? row.lastRetryAt.toISOString() : null,
        nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
      }));

      return retryJobs;
    } catch (error) {
      logger.error(`Failed to get pending retries: ${error.message}`);
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }
}

// Export singleton instance
module.exports = new JobManager();
