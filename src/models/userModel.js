const pool = require('../utils/db');
const { generateId } = require('../utils/idGenerator');

/**
 * Ensures a user exists in the database. If not, creates one.
 * @param {string} phoneNumber - The user's phone number.
 * @returns {Promise<object>} The user object.
 */
async function ensureUser(phoneNumber) {
  const userId = generateId(12);
  const db = await pool.getConnection();
  try {
    await db.execute(
      `INSERT INTO users (id, phone_number, is_active, created_at, updated_at)
       VALUES (?, ?, 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [userId, phoneNumber]
    );

    const [rows] = await db.execute(
      `SELECT id, phone_number, is_active, current_trip_id, created_at, updated_at
       FROM users WHERE phone_number = ?`,
      [phoneNumber]
    );
    return rows[0];
  } finally {
    db.release();
  }
}

/**
 * Finds a user by their phone number, joining with their current trip information.
 * @param {string} phoneNumber - The user's phone number.
 * @returns {Promise<object|null>} The user object with trip details, or null if not found.
 */
async function findByPhoneNumber(phoneNumber) {
  const db = await pool.getConnection();
  try {
    const [users] = await db.execute(
      `
      SELECT u.*, t.event_name as current_trip_name, t.started_at as trip_started_at, t.total_amount, t.currency as current_trip_currency
      FROM users u
      LEFT JOIN trips t ON u.current_trip_id = t.id
      WHERE u.phone_number = ?
    `,
      [phoneNumber]
    );
    return users.length > 0 ? users[0] : null;
  } finally {
    db.release();
  }
}

/**
 * Gets the current trip status for a user by their phone number.
 * @param {string} phoneNumber - The user's phone number.
 * @returns {Promise<object|null>} The user's trip status, or null if not found.
 */
async function getStatusByPhoneNumber(phoneNumber) {
  const db = await pool.getConnection();
  try {
    const [result] = await db.execute(
      `
      SELECT
        u.is_active,
        t.id as trip_id,
        t.event_name,
        t.started_at,
        t.total_amount,
        t.currency,
        COUNT(tr.id) as transaction_count
      FROM users u
      LEFT JOIN trips t ON u.current_trip_id = t.id
      LEFT JOIN transactions tr ON t.id = tr.trip_id
      WHERE u.phone_number = ?
      GROUP BY u.id, t.id
    `,
      [phoneNumber]
    );
    return result.length > 0 ? result[0] : null;
  } finally {
    db.release();
  }
}

async function findUserByPhoneNumber(phoneNumber) {
  const db = await pool.getConnection();
  try {
    const [users] = await db.execute(
      `SELECT id, phone_number FROM users WHERE phone_number = ?`,
      [phoneNumber]
    );
    return users.length > 0 ? users[0] : null;
  } finally {
    db.release();
  }
}

module.exports = {
  ensureUser,
  findByPhoneNumber,
  getStatusByPhoneNumber,
  findUserByPhoneNumber,
};
