const pool = require('./db');
const logger = require('./logger');
const { generateId } = require('./idGenerator');

async function withConnection(callback) {
  let connection;
  try {
    connection = await pool.getConnection();
    return await callback(connection);
  } catch (error) {
    logger.error(`Database operation failed: ${error.message}`);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

class JobManager {
  constructor() {
    this.initializeTable();
  }

  async initializeTable() {
    return withConnection(async connection => {
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS webhook_timers (
          id VARCHAR(12) PRIMARY KEY,
          trip_id VARCHAR(12) NOT NULL,
          webhook_url TEXT NOT NULL,
          sender_id VARCHAR(12) NULL,
          deadline_timestamp BIGINT NOT NULL,
          status ENUM('active', 'expired', 'completed') NOT NULL DEFAULT 'active',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_trip_id_status (trip_id, status),
          INDEX idx_deadline (deadline_timestamp),
          INDEX idx_status_deadline (status, deadline_timestamp),
          FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
    });
  }

  async readJobs() {
    return withConnection(async connection => {
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
      return rows.map(row => ({
        ...row,
        deadline: parseInt(row.deadline, 10),
      }));
    });
  }

  async addOrUpdateJob(
    tripId,
    webhookUrl,
    senderId = null,
    durationMs = 15 * 60 * 1000
  ) {
    return withConnection(async connection => {
      const deadline = Date.now() + durationMs;
      const tripIdStr = String(tripId);
      const jobId = generateId(12);

      await connection.execute(
        `
        INSERT INTO webhook_timers (id, trip_id, webhook_url, sender_id, deadline_timestamp, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON DUPLICATE KEY UPDATE
        webhook_url = VALUES(webhook_url),
        sender_id = VALUES(sender_id),
        deadline_timestamp = VALUES(deadline_timestamp),
        updated_at = NOW()
      `,
        [jobId, tripIdStr, webhookUrl, senderId, deadline]
      );

      const [updatedRows] = await connection.execute(
        'SELECT * FROM webhook_timers WHERE trip_id = ? AND status = ?',
        [tripIdStr, 'active']
      );
      logger.info(`Timer created/updated for trip ${tripIdStr}`);
      return {
        ...updatedRows[0],
        deadline: parseInt(updatedRows[0].deadline_timestamp, 10),
      };
    });
  }

  async removeJob(tripId) {
    return withConnection(async connection => {
      const [result] = await connection.execute(
        `DELETE FROM webhook_timers WHERE trip_id = ? AND status = 'active'`,
        [String(tripId)]
      );
      const removed = result.affectedRows > 0;
      if (removed) {
        logger.info(`Timer cancelled for trip ${tripId}`);
      }
      return removed;
    });
  }

  async getExpiredJobs() {
    return withConnection(async connection => {
      const now = Date.now();
      const [rows] = await connection.execute(
        `
        SELECT wt.id, wt.trip_id as tripId, wt.webhook_url as webhookUrl,
               wt.sender_id as senderId, wt.deadline_timestamp as deadline,
               u.phone_number as phoneNumber
        FROM webhook_timers wt
        LEFT JOIN users u ON wt.sender_id = u.id
        WHERE wt.status = 'active' AND wt.deadline_timestamp <= ?
        ORDER BY wt.deadline_timestamp ASC
      `,
        [now]
      );
      return rows.map(row => ({
        ...row,
        deadline: parseInt(row.deadline, 10),
      }));
    });
  }

  async removeJobs(tripIds) {
    if (!tripIds || tripIds.length === 0) return 0;
    return withConnection(async connection => {
      const placeholders = tripIds.map(() => '?').join(',');
      const [result] = await connection.execute(
        `UPDATE webhook_timers SET status = 'completed', updated_at = NOW()
         WHERE trip_id IN (${placeholders}) AND status = 'active'`,
        tripIds.map(String)
      );
      const removedCount = result.affectedRows;
      if (removedCount > 0) {
        logger.info(`${removedCount} timers completed`);
      }
      return removedCount;
    });
  }

  async getAllJobs() {
    return this.readJobs();
  }

  async getJobByTripId(tripId) {
    return withConnection(async connection => {
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
        [String(tripId)]
      );
      if (rows.length === 0) return null;
      return { ...rows[0], deadline: parseInt(rows[0].deadline_timestamp, 10) };
    });
  }
}

module.exports = new JobManager();
