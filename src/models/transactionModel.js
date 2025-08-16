const pool = require('../utils/db');
const { generateId } = require('../utils/idGenerator');
const { toMinor } = require('../utils/currency');

async function getTripAndEnforceCurrency(db, tripId, requestedCurrency) {
  const [trips] = await db.execute(
    `SELECT id, status, event_name, currency FROM trips WHERE id = ?`,
    [tripId]
  );
  if (trips.length === 0) return { notFound: true };
  const trip = trips[0];
  if (trip.status !== 'active') {
    return { trip, completed: true };
  }
  if (
    trip.currency &&
    requestedCurrency &&
    trip.currency !== requestedCurrency
  ) {
    return { trip, currencyMismatch: true };
  }
  return { trip };
}

async function create(transactionData) {
  const {
    trip_id,
    total_amount,
    merchant,
    date,
    subtotal,
    tax_amount,
    item_count,
    item_summary,
    currency = 'IDR',
  } = transactionData;

  const transactionId = generateId(12);
  const db = await pool.getConnection();
  try {
    const result = await getTripAndEnforceCurrency(db, trip_id, currency);
    if (result.notFound) {
      throw new Error('Trip not found');
    }
    if (result.completed) {
      throw new Error('Cannot add transactions to a completed trip');
    }
    if (result.currencyMismatch) {
      throw new Error(
        `Trip currency (${result.trip.currency}) does not match transaction currency (${currency})`
      );
    }
    const trip = result.trip;

    await db.execute(
      `
      INSERT INTO transactions (id, trip_id, currency, merchant, date, total_amount, subtotal, tax_amount, item_count, item_summary, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
      [
        transactionId,
        trip_id,
        currency,
        merchant || null,
        date || null,
        toMinor(currency, total_amount),
        subtotal !== undefined ? toMinor(currency, subtotal) : null,
        tax_amount !== undefined ? toMinor(currency, tax_amount) : null,
        item_count ? parseInt(item_count) : null,
        item_summary || null,
      ]
    );

    if (!trip.currency) {
      await db.execute(`UPDATE trips SET currency = ? WHERE id = ?`, [
        currency,
        trip_id,
      ]);
    }
    return {
      transaction_id: transactionId,
      trip_id,
      currency,
      total_amount,
      merchant,
    };
  } finally {
    db.release();
  }
}

async function findById(transactionId) {
  const db = await pool.getConnection();
  try {
    const [transactions] = await db.execute(
      `
      SELECT t.*, tr.event_name, tr.phone_number
      FROM transactions t
      JOIN trips tr ON t.trip_id = tr.id
      WHERE t.id = ?
    `,
      [transactionId]
    );
    return transactions.length > 0 ? transactions[0] : null;
  } finally {
    db.release();
  }
}

async function findAll({
  trip_id,
  merchant,
  date_from,
  date_to,
  limit = 20,
  offset = 0,
}) {
  const db = await pool.getConnection();
  try {
    let query = `
      SELECT t.*, tr.event_name, tr.phone_number
      FROM transactions t
      JOIN trips tr ON t.trip_id = tr.id
      WHERE 1=1
    `;
    const params = [];

    if (trip_id) {
      query += ' AND t.trip_id = ?';
      params.push(trip_id);
    }
    if (merchant) {
      query += ' AND t.merchant LIKE ?';
      params.push(`%${merchant}%`);
    }
    if (date_from) {
      query += ' AND t.date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND t.date <= ?';
      params.push(date_to);
    }

    query += `
      ORDER BY t.recorded_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit), parseInt(offset));

    const [transactions] = await db.execute(query, params);
    return transactions;
  } finally {
    db.release();
  }
}

module.exports = {
  create,
  findById,
  findAll,
};
