const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');
const { toMinor } = require('../utils/currency');
const { formatTransaction } = require('../utils/payloadFormatter');

// --- Helper Functions ---

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
  // If trip has a currency set and request specifies a different one, reject
  if (
    trip.currency &&
    requestedCurrency &&
    trip.currency !== requestedCurrency
  ) {
    return { trip, currencyMismatch: true };
  }
  return { trip };
}

const createTransaction = async (req, res) => {
  const {
    tripId,
    totalAmount,
    merchant,
    date,
    subtotal,
    taxAmount,
    itemCount,
    itemSummary,
    currency = 'IDR',
  } = req.body;
  const newTransactionId = generateId(12);
  const db = await pool.getConnection();

  try {
    // Verify trip exists and is active
    const result = await getTripAndEnforceCurrency(db, tripId, currency);
    if (result.notFound) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    if (result.completed) {
      return res
        .status(400)
        .json({ error: 'Cannot add transactions to a completed trip' });
    }
    if (result.currencyMismatch) {
      return res.status(400).json({
        error: `Trip currency (${result.trip.currency}) does not match transaction currency (${currency})`,
      });
    }
    const trip = result.trip;

    // Create transaction with new invoice schema
    await db.execute(
      `
      INSERT INTO transactions (id, trip_id, currency, merchant, date, total_amount, subtotal, tax_amount, item_count, item_summary, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
      [
        newTransactionId,
        tripId,
        currency,
        merchant || null,
        date || null,
        toMinor(currency, totalAmount),
        subtotal !== undefined ? toMinor(currency, subtotal) : null,
        taxAmount !== undefined ? toMinor(currency, taxAmount) : null,
        itemCount ? parseInt(itemCount) : null,
        itemSummary || null,
      ]
    );

    // If trip has no currency set (legacy), set it now to enforce single-currency per trip
    if (!trip.currency) {
      await db.execute(`UPDATE trips SET currency = ? WHERE id = ?`, [
        currency,
        tripId,
      ]);
    }

    logger.info(
      {
        transactionId: newTransactionId,
        tripId,
        total_amount: parseInt(totalAmount),
        merchant: merchant || 'No merchant',
        item_count: itemCount || 0,
      },
      'Invoice transaction created successfully'
    );

    // Use the formatter for the response
    const tempTransaction = {
      total_amount: toMinor(currency, totalAmount),
      currency,
    };
    const formatted = formatTransaction(tempTransaction);
    const message = `Invoice of ${formatted.displayAmount} recorded successfully`;

    res.status(201).json({
      success: true,
      transactionId: newTransactionId,
      tripId,
      currency,
      amount: formatted.amount,
      displayAmount: formatted.displayAmount,
      merchant: merchant || null,
      message,
    });
  } catch (err) {
    logger.error({ err, reqBody: req.body }, 'Failed to create transaction');
    res.status(500).json({ error: 'Failed to record transaction' });
  } finally {
    db.release();
  }
};

const getTransactionById = async (req, res) => {
  const { transactionId } = req.params;
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

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const payload = formatTransaction(transactions[0]);
    res.status(200).json({ data: payload });
  } catch (err) {
    logger.error({ err, transactionId }, 'Failed to fetch transaction');
    res.status(500).json({ error: 'Failed to fetch transaction' });
  } finally {
    db.release();
  }
};

const getTransactions = async (req, res) => {
  const {
    tripId,
    merchant,
    dateFrom,
    dateTo,
    limit = 20,
    offset = 0,
  } = req.query;
  const db = await pool.getConnection();

  try {
    let query = `
      SELECT t.*, tr.event_name, tr.phone_number
      FROM transactions t
      JOIN trips tr ON t.trip_id = tr.id
      WHERE 1=1
    `;
    const params = [];

    if (tripId) {
      query += ' AND t.trip_id = ?';
      params.push(tripId);
    }

    if (merchant) {
      query += ' AND t.merchant LIKE ?';
      params.push(`%${merchant}%`);
    }

    if (dateFrom) {
      query += ' AND t.date >= ?';
      params.push(dateFrom);
    }

    if (dateTo) {
      query += ' AND t.date <= ?';
      params.push(dateTo);
    }

    query += `
      ORDER BY t.recorded_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit), parseInt(offset));

    const [transactions] = await db.execute(query, params);

    const data = transactions.map(t => formatTransaction(t));

    res.status(200).json({
      data,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch transactions');
    res.status(500).json({ error: 'Failed to fetch transactions' });
  } finally {
    db.release();
  }
};

module.exports = {
  createTransaction,
  getTransactionById,
  getTransactions,
};
