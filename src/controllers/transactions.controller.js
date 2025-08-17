const { generateId } = require('../utils/idGenerator');
const pool = require('../utils/db');
const logger = require('../utils/logger');

// Helpers for currency handling
function toMinor(currency, value) {
  if (currency === 'USD') {
    // Support numbers or numeric strings, round to cents
    const num = typeof value === 'string' ? Number(value) : value;
    return Math.round(num * 100);
  }
  // IDR: already integer rupiah
  return parseInt(value);
}

function toMajor(currency, minor) {
  const n = typeof minor === 'string' ? parseInt(minor) : minor;
  if (currency === 'USD') {
    return Number((n / 100).toFixed(2));
  }
  return n; // IDR
}

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

    // Format amount with thousand separators for IDR
    const major = toMajor(currency, toMinor(currency, totalAmount));
    const minorAmount = toMinor(currency, totalAmount);
    const displayAmount = formatAmountForDisplay(currency, minorAmount);
    const message = `Invoice of ${displayAmount} recorded successfully`;

    res.status(201).json({
      success: true,
      transactionId: newTransactionId,
      tripId,
      currency,
      amount: major,
      displayAmount,
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

    const t = transactions[0];
    const currency = t.currency || 'IDR';
    const payload = {
      ...t,
      currency,
      amount: t.total_amount ? toMajor(currency, t.total_amount) : 0,
      displayAmount: t.total_amount
        ? formatAmountForDisplay(currency, parseInt(t.total_amount))
        : formatAmountForDisplay(currency, 0),
    };
    if (t.subtotal !== null && t.subtotal !== undefined) {
      payload.subtotalAmount = toMajor(currency, t.subtotal);
      payload.subtotalDisplay = formatAmountForDisplay(
        currency,
        parseInt(t.subtotal)
      );
    }
    if (t.tax_amount !== null && t.tax_amount !== undefined) {
      payload.taxAmount = toMajor(currency, t.tax_amount);
      payload.taxDisplay = formatAmountForDisplay(
        currency,
        parseInt(t.tax_amount)
      );
    }

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

    // Map with currency and dual amounts
    const data = transactions.map(t => {
      const currency = t.currency || 'IDR';
      const row = {
        ...t,
        currency,
        amount: t.total_amount ? toMajor(currency, t.total_amount) : 0,
        displayAmount: t.total_amount
          ? formatAmountForDisplay(currency, parseInt(t.total_amount))
          : formatAmountForDisplay(currency, 0),
      };
      if (t.subtotal !== null && t.subtotal !== undefined) {
        row.subtotalAmount = toMajor(currency, t.subtotal);
        row.subtotalDisplay = formatAmountForDisplay(
          currency,
          parseInt(t.subtotal)
        );
      }
      if (t.tax_amount !== null && t.tax_amount !== undefined) {
        row.taxAmount = toMajor(currency, t.tax_amount);
        row.taxDisplay = formatAmountForDisplay(
          currency,
          parseInt(t.tax_amount)
        );
      }
      return row;
    });

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
