const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

function formatAmountForDisplay(currency, minorAmount) {
  const major =
    currency === 'USD' ? Number((minorAmount / 100).toFixed(2)) : minorAmount;
  const symbol = currency === 'USD' ? '$' : 'Rp';

  if (currency === 'USD') {
    const formatted = major.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${symbol} ${formatted}`;
  } else {
    // IDR: Use Indonesian format with periods as thousand separators
    const formatted = major.toLocaleString('id-ID').replace(/,/g, '.');
    return `${symbol}${formatted}`;
  }
}

const createUser = async (req, res) => {
  const { phoneNumber } = req.body;
  const userId = generateId(12);
  const db = await pool.getConnection();
  try {
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

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        is_active: Boolean(user.is_active),
        current_trip_id: user.current_trip_id,
        created_at: user.created_at,
        updated_at: user.updated_at,
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

    // Convert total_amount to integer for IDR if it exists
    const user = users[0];
    if (user.total_amount !== null) {
      const currency = user.current_trip_currency || 'IDR';
      const minor = parseInt(user.total_amount);
      const major =
        currency === 'USD' ? Number((minor / 100).toFixed(2)) : minor;
      user.amount = major;
      user.display_amount = formatAmountForDisplay(currency, minor);
      user.currency = currency;
    }

    res.status(200).json({ data: user });
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

    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const status = result[0];
    res.status(200).json({
      is_active: Boolean(status.is_active),
      current_trip: status.trip_id
        ? (() => {
            const currency = status.currency || 'IDR';
            const minor = parseInt(status.total_amount || 0);
            const major =
              currency === 'USD' ? Number((minor / 100).toFixed(2)) : minor;
            return {
              trip_id: status.trip_id,
              event_name: status.event_name,
              started_at: status.started_at,
              currency,
              amount: major,
              display_amount: formatAmountForDisplay(currency, minor),
              transaction_count: parseInt(status.transaction_count || 0),
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

module.exports = {
  createUser,
  getUserByPhoneNumber,
  getUserStatus,
};
