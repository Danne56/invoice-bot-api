const pool = require('./db');
const logger = require('./logger');
const { generateId } = require('./idGenerator');

/**
 * Job Manager for handling timer-based webhook jobs
 * Manages persistence of job data in database webhook_timers table
 */
class JobManager {
  constructor() {
    this.initializeTable();
  }

  /**
   * Ensure webhook_timers table exists, create if not
   */
  async initializeTable() {
    try {
      const connection = await pool.getConnection();
      try {
        await connection.execute(`
          CREATE TABLE IF NOT EXISTS webhook_timers (
            id VARCHAR(12) PRIMARY KEY,
            trip_id VARCHAR(12) NOT NULL,
            webhook_url TEXT NOT NULL,
            deadline_timestamp BIGINT NOT NULL,
            status ENUM('active', 'expired', 'completed') NOT NULL DEFAULT 'active',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_trip_id (trip_id),
            INDEX idx_deadline (deadline_timestamp),
            INDEX idx_status (status),
            INDEX idx_status_deadline (status, deadline_timestamp)
          )
        `);
        logger.debug('Webhook timers table initialized');
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize webhook_timers table');
      // Don't throw here as the app should continue even if table creation fails
    }
  }

  /**
   * Read all active jobs from database
   * @returns {Promise<Array>} Array of job objects
   */
  async readJobs() {
    try {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.execute(
          `SELECT id, trip_id as tripId, webhook_url as webhookUrl,
           deadline_timestamp as deadline, status, created_at as createdAt,
           updated_at as updatedAt FROM webhook_timers
           WHERE status = 'active' ORDER BY deadline_timestamp ASC`
        );

        return rows.map(row => ({
          ...row,
          deadline: parseInt(row.deadline),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to read jobs from database');
      throw error;
    }
  }

  /**
   * Add or update a job for a tripId
   * If tripId already exists, updates the deadline (timer restart)
   * @param {string|number} tripId - Trip identifier
   * @param {string} webhookUrl - Webhook URL to call when timer expires
   * @returns {Promise<Object>} Job object that was added/updated
   */
  async addOrUpdateJob(tripId, webhookUrl) {
    try {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const deadline = Date.now() + 15 * 60 * 1000; // 15 minutes from now
        const tripIdStr = tripId.toString();

        // Check if job already exists
        const [existing] = await connection.execute(
          `SELECT id, created_at FROM webhook_timers WHERE trip_id = ? AND status = 'active'`,
          [tripIdStr]
        );

        let jobData;

        if (existing.length > 0) {
          // Update existing job (timer restart)
          await connection.execute(
            `UPDATE webhook_timers SET webhook_url = ?, deadline_timestamp = ?,
             updated_at = NOW() WHERE trip_id = ? AND status = 'active'`,
            [webhookUrl, deadline, tripIdStr]
          );

          jobData = {
            id: existing[0].id,
            tripId: tripIdStr,
            webhookUrl,
            deadline,
            status: 'active',
            createdAt: existing[0].created_at.toISOString(),
            updatedAt: new Date().toISOString(),
          };

          logger.info(
            { tripId: tripIdStr, webhookUrl, deadline },
            'Job updated - timer restarted'
          );
        } else {
          // Create new job
          const jobId = generateId(12);
          const now = new Date();

          await connection.execute(
            `INSERT INTO webhook_timers (id, trip_id, webhook_url, deadline_timestamp, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
            [jobId, tripIdStr, webhookUrl, deadline]
          );

          jobData = {
            id: jobId,
            tripId: tripIdStr,
            webhookUrl,
            deadline,
            status: 'active',
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };

          logger.info(
            { tripId: tripIdStr, webhookUrl, deadline },
            'New job added'
          );
        }

        await connection.commit();
        return jobData;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(
        { err: error, tripId, webhookUrl },
        'Failed to add/update job'
      );
      throw error;
    }
  }

  /**
   * Remove a job by tripId
   * @param {string|number} tripId - Trip identifier
   * @returns {Promise<boolean>} True if job was found and removed
   */
  async removeJob(tripId) {
    try {
      const connection = await pool.getConnection();
      try {
        const [result] = await connection.execute(
          `DELETE FROM webhook_timers WHERE trip_id = ? AND status = 'active'`,
          [tripId.toString()]
        );

        const removed = result.affectedRows > 0;
        if (removed) {
          logger.info({ tripId }, 'Job removed');
        }
        return removed;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error({ err: error, tripId }, 'Failed to remove job');
      throw error;
    }
  }

  /**
   * Get all jobs that have expired (deadline passed)
   * @returns {Promise<Array>} Array of expired job objects
   */
  async getExpiredJobs() {
    try {
      const connection = await pool.getConnection();
      try {
        const now = Date.now();
        const [rows] = await connection.execute(
          `SELECT id, trip_id as tripId, webhook_url as webhookUrl,
           deadline_timestamp as deadline, status, created_at as createdAt,
           updated_at as updatedAt FROM webhook_timers
           WHERE status = 'active' AND deadline_timestamp <= ?
           ORDER BY deadline_timestamp ASC`,
          [now]
        );

        const expiredJobs = rows.map(row => ({
          ...row,
          deadline: parseInt(row.deadline),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));

        logger.debug(
          { total: rows.length, expired: expiredJobs.length },
          'Checked for expired jobs'
        );

        return expiredJobs;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to get expired jobs');
      throw error;
    }
  }

  /**
   * Remove multiple jobs by tripIds
   * @param {Array} tripIds - Array of trip identifiers
   * @returns {Promise<number>} Number of jobs removed
   */
  async removeJobs(tripIds) {
    try {
      if (tripIds.length === 0) return 0;

      const connection = await pool.getConnection();
      try {
        const tripIdStrings = tripIds.map(id => id.toString());
        const placeholders = tripIdStrings.map(() => '?').join(',');

        const [result] = await connection.execute(
          `UPDATE webhook_timers SET status = 'completed', updated_at = NOW()
           WHERE trip_id IN (${placeholders}) AND status = 'active'`,
          tripIdStrings
        );

        const removedCount = result.affectedRows;

        if (removedCount > 0) {
          logger.info(
            { tripIds, removedCount },
            'Multiple jobs marked as completed'
          );
        }

        return removedCount;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error({ err: error, tripIds }, 'Failed to remove multiple jobs');
      throw error;
    }
  }

  /**
   * Get all pending jobs (for debugging/monitoring)
   * @returns {Promise<Array>} Array of all active job objects
   */
  async getAllJobs() {
    try {
      return await this.readJobs();
    } catch (error) {
      logger.error({ err: error }, 'Failed to get all jobs');
      throw error;
    }
  }

  /**
   * Get job by tripId
   * @param {string|number} tripId - Trip identifier
   * @returns {Promise<Object|null>} Job object or null if not found
   */
  async getJobByTripId(tripId) {
    try {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.execute(
          `SELECT id, trip_id as tripId, webhook_url as webhookUrl,
           deadline_timestamp as deadline, status, created_at as createdAt,
           updated_at as updatedAt FROM webhook_timers
           WHERE trip_id = ? AND status = 'active' LIMIT 1`,
          [tripId.toString()]
        );

        if (rows.length === 0) return null;

        const row = rows[0];
        return {
          ...row,
          deadline: parseInt(row.deadline),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error({ err: error, tripId }, 'Failed to get job by tripId');
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new JobManager();
