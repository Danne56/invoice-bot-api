const pool = require('../utils/db');
const { generateId } = require('../utils/idGenerator');

async function create(phoneNumber, eventName, currency = 'IDR') {
  const tripId = generateId(12);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();

    const [users] = await db.execute(
      `SELECT id FROM users WHERE phone_number = ?`,
      [phoneNumber]
    );
    if (users.length === 0) {
      throw new Error('User not found');
    }
    const userId = users[0].id;

    await db.execute(
      `UPDATE users SET is_active = 1, current_trip_id = ? WHERE id = ?`,
      [tripId, userId]
    );

    await db.execute(
      `INSERT INTO trips (id, phone_number, event_name, currency, started_at, status, total_amount)
       VALUES (?, ?, ?, ?, NOW(), 'active', 0)`,
      [tripId, phoneNumber, eventName, currency]
    );

    await db.commit();
    return {
      trip_id: tripId,
      user_id: userId,
      currency,
      event_name: eventName,
    };
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

async function stop(tripId) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();

    const [trips] = await db.execute(
      `SELECT id, phone_number, event_name, status, currency FROM trips WHERE id = ? FOR UPDATE`,
      [tripId]
    );
    if (trips.length === 0) {
      throw new Error('Trip not found');
    }
    const trip = trips[0];
    if (trip.status !== 'active') {
      throw new Error('Trip already completed');
    }

    const [sumRows] = await db.execute(
      `SELECT COALESCE(SUM(total_amount),0) as total FROM transactions WHERE trip_id = ?`,
      [tripId]
    );
    const totalMinor = parseInt(sumRows[0].total, 10);

    await db.execute(
      `UPDATE trips SET status='completed', ended_at = NOW(), total_amount = ? WHERE id = ?`,
      [totalMinor, tripId]
    );

    await db.execute(
      `UPDATE users SET is_active = 0, current_trip_id = NULL WHERE phone_number = ?`,
      [trip.phone_number]
    );

    await db.commit();
    return { ...trip, total_amount: totalMinor };
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

async function findById(tripId) {
  const db = await pool.getConnection();
  try {
    const [trips] = await db.execute(`SELECT * FROM trips WHERE id = ?`, [
      tripId,
    ]);
    if (trips.length === 0) {
      return null;
    }
    const trip = trips[0];

    const [transactions] = await db.execute(
      `SELECT * FROM transactions WHERE trip_id = ? ORDER BY recorded_at DESC`,
      [tripId]
    );
    trip.transactions = transactions;
    return trip;
  } finally {
    db.release();
  }
}

async function findAllByUser(phoneNumber, { status, limit = 10, offset = 0 }) {
  const db = await pool.getConnection();
  try {
    let query = `
      SELECT t.*, COUNT(tr.id) as transaction_count
      FROM trips t
      LEFT JOIN transactions tr ON t.id = tr.trip_id
      WHERE t.phone_number = ?
    `;
    const params = [phoneNumber];

    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }

    query += `
      GROUP BY t.id
      ORDER BY t.started_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const [trips] = await db.execute(query, params);
    return trips;
  } finally {
    db.release();
  }
}

async function getSummary(tripId) {
  const db = await pool.getConnection();
  try {
    const [trips] = await db.execute(
      `SELECT id, event_name, phone_number, started_at, ended_at, total_amount, status, currency
       FROM trips WHERE id = ?`,
      [tripId]
    );
    if (trips.length === 0) {
      return null;
    }
    const trip = trips[0];

    const [summary] = await db.execute(
      `
      SELECT
        COUNT(*) as total_transactions,
        COALESCE(SUM(total_amount), 0) as calculated_total,
        AVG(total_amount) as average_expense,
        MIN(total_amount) as min_expense,
        MAX(total_amount) as max_expense,
        COUNT(CASE WHEN merchant IS NOT NULL THEN 1 END) as transactions_with_merchant
      FROM transactions
      WHERE trip_id = ?
    `,
      [tripId]
    );

    const [curRows] = await db.execute(
      `SELECT DISTINCT currency FROM transactions WHERE trip_id = ?`,
      [tripId]
    );
    const distinctCurrencies = curRows.map(r => r.currency).filter(Boolean);

    return {
      trip_info: trip,
      expense_summary: summary[0],
      distinct_currencies: distinctCurrencies,
    };
  } finally {
    db.release();
  }
}

async function findActiveByPhoneNumber(phoneNumber) {
  const db = await pool.getConnection();
  try {
    const [active] = await db.execute(
      `SELECT id FROM trips WHERE phone_number = ? AND status = 'active' LIMIT 1`,
      [phoneNumber]
    );
    return active.length > 0 ? active[0] : null;
  } finally {
    db.release();
  }
}

module.exports = {
  create,
  stop,
  findById,
  findAllByUser,
  getSummary,
  findActiveByPhoneNumber,
};
