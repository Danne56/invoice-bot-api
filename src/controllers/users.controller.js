const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');
const { formatAmount } = require('../utils/payloadFormatter');

const createUser = async (req, res) => {
  const { phoneNumber } = req.body;
  const userId = generateId(12);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.execute(
      `INSERT INTO users (id, phone_number, is_active, created_at, updated_at)
       VALUES (?, ?, 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [userId, phoneNumber]
    );

    // Fetch current state
    const [rows] = await db.execute(
      `SELECT id, phone_number, is_active, current_trip_id, created_at, updated_at
       FROM users WHERE phone_number = ?`,
      [phoneNumber]
    );
    const user = rows[0];

    await db.commit();
    res.status(201).json({
      success: true,
      user: {
        userId: user.id,
        phoneNumber: user.phone_number,
        isActive: Boolean(user.is_active),
        currentTripId: user.current_trip_id,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      message: 'User ensured/created successfully',
    });
  } catch (err) {
    await db.rollback();
    logger.error({ err, reqBody: req.body }, 'Failed to create user');
    res.status(500).json({ error: 'Failed to create user' });
  } finally {
    db.release();
  }
};

const getUserByPhoneNumber = async (req, res) => {
  const { phoneNumber } = req.params;
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

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Create consistent response format
    const responseUser = {
      userId: user.id,
      phoneNumber: user.phone_number,
      isActive: Boolean(user.is_active),
      currentTripId: user.current_trip_id,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };

    // Add trip information if available
    if (user.current_trip_name) {
      responseUser.currentTripName = user.current_trip_name;
      responseUser.tripStartedAt = user.trip_started_at;
    }

    if (user.total_amount !== null) {
      const currency = user.current_trip_currency || 'IDR';
      const { amount, displayAmount } = formatAmount(
        currency,
        user.total_amount
      );
      responseUser.amount = amount;
      responseUser.displayAmount = displayAmount;
      responseUser.currency = currency;
    }

    res.status(200).json({ data: responseUser });
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to fetch user');
    res.status(500).json({ error: 'Failed to fetch user' });
  } finally {
    db.release();
  }
};

const getUserStatus = async (req, res) => {
  const { phoneNumber } = req.params;
  const db = await pool.getConnection();

  try {
    const [result] = await db.execute(
      `
      SELECT
        u.id,
        u.is_active,
        u.intro_sent_today,
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

    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const status = result[0];
    res.status(200).json({
      userId: status.id,
      isActive: Boolean(status.is_active),
      introSentToday: Boolean(status.intro_sent_today),
      currentTrip: status.trip_id
        ? (() => {
            const currency = status.currency || 'IDR';
            const { amount, displayAmount } = formatAmount(
              currency,
              status.total_amount
            );
            return {
              tripId: status.trip_id,
              eventName: status.event_name,
              startedAt: status.started_at,
              currency,
              amount,
              displayAmount,
              transactionCount: parseInt(status.transaction_count || 0),
            };
          })()
        : null,
    });
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to fetch user status');
    res.status(500).json({ error: 'Failed to fetch user status' });
  } finally {
    db.release();
  }
};

const markIntroSent = async (req, res) => {
  const { userId } = req.params;
  const db = await pool.getConnection();

  try {
    // Verify user exists
    const [user] = await db.execute('SELECT id FROM users WHERE id = ?', [
      userId,
    ]);
    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update intro_sent_today flag
    const [result] = await db.execute(
      'UPDATE users SET intro_sent_today = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info({
      message: `Intro marked as sent for user ${userId}`,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({
      message: 'DB Error (mark intro sent)',
      error: err.message,
    });
    res.status(500).json({ error: 'Failed to update intro status' });
  } finally {
    db.release();
  }
};

const resetIntroFlags = async (req, res) => {
  const db = await pool.getConnection();

  try {
    const [result] = await db.execute(
      'UPDATE users SET intro_sent_today = 0, updated_at = CURRENT_TIMESTAMP WHERE intro_sent_today = 1'
    );

    logger.info({
      message: 'Intro flags reset successfully',
      affectedRows: result.affectedRows,
    });

    res.status(200).json({
      success: true,
      message: `Reset intro flags for ${result.affectedRows} users`,
    });
  } catch (err) {
    logger.error({
      message: 'DB Error (reset intro)',
      error: err.message,
    });
    res.status(500).json({ error: 'Failed to reset intro flags' });
  } finally {
    db.release();
  }
};

module.exports = {
  createUser,
  getUserByPhoneNumber,
  getUserStatus,
  markIntroSent,
  resetIntroFlags,
};
