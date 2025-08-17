const pool = require('../utils/db');
const logger = require('../utils/logger');
const { generateId } = require('../utils/idGenerator');

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

const createTrip = async (req, res) => {
  const { phoneNumber, eventName, currency = 'IDR' } = req.body;
  const tripId = generateId(12);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();

    // Ensure no active trip exists
    const [active] = await db.execute(
      `SELECT id FROM trips WHERE phone_number = ? AND status = 'active' LIMIT 1`,
      [phoneNumber]
    );
    if (active.length > 0) {
      await db.rollback();
      return res.status(400).json({
        error: 'Active trip already exists',
        activeTripId: active[0].id,
      });
    }

    // Check if user exists (don't create)
    const [users] = await db.execute(
      `SELECT id FROM users WHERE phone_number = ?`,
      [phoneNumber]
    );

    if (users.length === 0) {
      await db.rollback();
      return res.status(404).json({
        error: 'User not found',
        message: 'User must be created first before starting a trip',
        phoneNumber,
      });
    }

    const userId = users[0].id;

    // Mark user as active
    await db.execute(
      `UPDATE users SET is_active = 1, updated_at = NOW() WHERE id = ?`,
      [userId]
    );

    // Create trip
    await db.execute(
      `INSERT INTO trips (id, phone_number, event_name, currency, started_at, status, total_amount)
       VALUES (?, ?, ?, ?, NOW(), 'active', 0)`,
      [tripId, phoneNumber, eventName, currency]
    );

    // Now update user's current_trip_id after trip is created
    await db.execute(
      `UPDATE users SET current_trip_id = ?, updated_at = NOW() WHERE id = ?`,
      [tripId, userId]
    );

    await db.commit();
    logger.info(
      { tripId, userId, phoneNumber, eventName, currency },
      'Trip started'
    );
    return res.status(201).json({
      success: true,
      tripId,
      userId,
      currency,
      eventName,
      message: `Trip '${eventName}' started (currency: ${currency})`,
    });
  } catch (err) {
    await db.rollback();
    logger.error({ err, reqBody: req.body }, 'Failed to start trip');
    return res.status(500).json({ error: 'Failed to start trip' });
  } finally {
    db.release();
  }
};

const stopTrip = async (req, res) => {
  const { tripId } = req.params;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [trips] = await db.execute(
      `SELECT id, phone_number, event_name, status, currency FROM trips WHERE id = ? FOR UPDATE`,
      [tripId]
    );
    if (trips.length === 0) {
      await db.rollback();
      return res.status(404).json({ error: 'Trip not found' });
    }
    const trip = trips[0];
    if (trip.status !== 'active') {
      await db.rollback();
      return res.status(400).json({ error: 'Trip already completed' });
    }

    const [sumRows] = await db.execute(
      `SELECT COALESCE(SUM(total_amount),0) as total FROM transactions WHERE trip_id = ?`,
      [tripId]
    );
    const totalMinor = parseInt(sumRows[0].total);

    await db.execute(
      `UPDATE trips SET status='completed', ended_at = NOW(), total_amount = ? WHERE id = ?`,
      [totalMinor, tripId]
    );

    await db.execute(
      `UPDATE users SET is_active = 0, current_trip_id = NULL, updated_at = NOW() WHERE phone_number = ?`,
      [trip.phone_number]
    );

    await db.commit();
    const currency = trip.currency || 'IDR';
    const totalMajor =
      currency === 'USD' ? Number((totalMinor / 100).toFixed(2)) : totalMinor;
    const displayAmount = formatAmountForDisplay(currency, totalMinor);
    logger.info({ tripId, totalMinor, currency }, 'Trip stopped');
    return res.status(200).json({
      success: true,
      tripId,
      eventName: trip.event_name,
      currency,
      amount: totalMajor,
      displayAmount,
      message: `Trip '${trip.event_name}' completed with total expense: ${displayAmount}`,
    });
  } catch (err) {
    await db.rollback();
    logger.error({ err, tripId }, 'Failed to stop trip');
    return res.status(500).json({ error: 'Failed to stop trip' });
  } finally {
    db.release();
  }
};

const getTripById = async (req, res) => {
  const { tripId } = req.params;
  const db = await pool.getConnection();

  try {
    // Get trip details
    const [trips] = await db.execute(
      `
      SELECT * FROM trips WHERE id = ?
    `,
      [tripId]
    );

    if (trips.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    // Get transactions for this trip
    const [transactions] = await db.execute(
      `
      SELECT * FROM transactions
      WHERE trip_id = ?
      ORDER BY recorded_at DESC
    `,
      [tripId]
    );

    const trip = trips[0];
    const tripCurrency = trip.currency || 'IDR';
    // Convert trip total to major by trip currency
    trip.amount =
      tripCurrency === 'USD'
        ? Number(((trip.total_amount || 0) / 100).toFixed(2))
        : parseInt(trip.total_amount || 0);
    trip.displayAmount = formatAmountForDisplay(
      tripCurrency,
      parseInt(trip.total_amount || 0)
    );
    trip.currency = tripCurrency;

    // Map transactions with currency and dual amounts
    trip.transactions = transactions.map(t => {
      const currency = t.currency || tripCurrency;
      const row = {
        ...t,
        currency,
        amount: t.total_amount
          ? currency === 'USD'
            ? Number((parseInt(t.total_amount) / 100).toFixed(2))
            : parseInt(t.total_amount)
          : 0,
        displayAmount: t.total_amount
          ? formatAmountForDisplay(currency, parseInt(t.total_amount))
          : formatAmountForDisplay(currency, 0),
      };
      if (t.subtotal !== null && t.subtotal !== undefined) {
        row.subtotalAmount =
          currency === 'USD'
            ? Number((parseInt(t.subtotal) / 100).toFixed(2))
            : parseInt(t.subtotal);
        row.subtotalDisplay = formatAmountForDisplay(
          currency,
          parseInt(t.subtotal)
        );
      }
      if (t.tax_amount !== null && t.tax_amount !== undefined) {
        row.taxAmount =
          currency === 'USD'
            ? Number((parseInt(t.tax_amount) / 100).toFixed(2))
            : parseInt(t.tax_amount);
        row.taxDisplay = formatAmountForDisplay(
          currency,
          parseInt(t.tax_amount)
        );
      }
      return row;
    });

    res.status(200).json({ data: trip });
  } catch (err) {
    logger.error({ err, tripId }, 'Failed to fetch trip');
    res.status(500).json({ error: 'Failed to fetch trip' });
  } finally {
    db.release();
  }
};

const getTrips = async (req, res) => {
  const { phoneNumber, status, limit = 10, offset = 0 } = req.query;
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
    params.push(parseInt(limit), parseInt(offset));

    const [trips] = await db.execute(query, params);

    // Convert totals for each trip using trip currency
    trips.forEach(trip => {
      const currency = trip.currency || 'IDR';
      trip.amount =
        currency === 'USD'
          ? Number(((trip.total_amount || 0) / 100).toFixed(2))
          : parseInt(trip.total_amount || 0);
      trip.displayAmount = formatAmountForDisplay(
        currency,
        parseInt(trip.total_amount || 0)
      );
      trip.currency = currency;
      trip.transactionCount = parseInt(trip.transaction_count);
    });

    res.status(200).json({
      data: trips,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (err) {
    logger.error({ err, phoneNumber }, 'Failed to fetch trips');
    res.status(500).json({ error: 'Failed to fetch trips' });
  } finally {
    db.release();
  }
};

const getTripSummary = async (req, res) => {
  const { tripId } = req.params;
  const db = await pool.getConnection();

  try {
    // Get trip basic info
    const [trips] = await db.execute(
      `
      SELECT id, event_name, phone_number, started_at, ended_at, total_amount, status
      FROM trips WHERE id = ?
    `,
      [tripId]
    );

    if (trips.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    // Get transaction summary
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

    const trip = trips[0];
    const stats = summary[0];

    // Enforce single-currency for summary
    const [curRows] = await db.execute(
      `SELECT DISTINCT currency FROM transactions WHERE trip_id = ?`,
      [tripId]
    );
    const distinctCurrencies = curRows.map(r => r.currency).filter(Boolean);
    const tripCurrency = trip.currency || 'IDR';
    if (
      distinctCurrencies.length > 1 ||
      (distinctCurrencies.length === 1 &&
        distinctCurrencies[0] !== tripCurrency)
    ) {
      return res.status(400).json({
        error:
          'Mixed currencies detected in this trip. Single-currency per trip is enforced.',
        details: {
          currencies: distinctCurrencies,
          tripCurrency,
        },
      });
    }

    res.status(200).json({
      tripInfo: {
        id: trip.id,
        eventName: trip.event_name,
        phoneNumber: trip.phone_number,
        startedAt: trip.started_at,
        endedAt: trip.ended_at,
        status: trip.status,
        currency: tripCurrency,
        recordedTotalAmount:
          tripCurrency === 'USD'
            ? Number((parseInt(trip.total_amount) / 100).toFixed(2))
            : parseInt(trip.total_amount),
        recordedTotalDisplay: formatAmountForDisplay(
          tripCurrency,
          parseInt(trip.total_amount)
        ),
      },
      expenseSummary: {
        totalTransactions: parseInt(stats.total_transactions),
        calculatedTotalAmount:
          tripCurrency === 'USD'
            ? Number((parseInt(stats.calculated_total) / 100).toFixed(2))
            : parseInt(stats.calculated_total),
        calculatedTotalDisplay: formatAmountForDisplay(
          tripCurrency,
          parseInt(stats.calculated_total)
        ),
        averageExpenseAmount:
          tripCurrency === 'USD'
            ? Number((parseInt(stats.average_expense || 0) / 100).toFixed(2))
            : parseInt(stats.average_expense || 0),
        averageExpenseDisplay: formatAmountForDisplay(
          tripCurrency,
          parseInt(stats.average_expense || 0)
        ),
        minExpenseAmount:
          tripCurrency === 'USD'
            ? Number((parseInt(stats.min_expense || 0) / 100).toFixed(2))
            : parseInt(stats.min_expense || 0),
        minExpenseDisplay: formatAmountForDisplay(
          tripCurrency,
          parseInt(stats.min_expense || 0)
        ),
        maxExpenseAmount:
          tripCurrency === 'USD'
            ? Number((parseInt(stats.max_expense || 0) / 100).toFixed(2))
            : parseInt(stats.max_expense || 0),
        maxExpenseDisplay: formatAmountForDisplay(
          tripCurrency,
          parseInt(stats.max_expense || 0)
        ),
        transactionsWithMerchant: parseInt(stats.transactions_with_merchant),
      },
    });
  } catch (err) {
    logger.error({ err, tripId }, 'Failed to fetch trip summary');
    res.status(500).json({ error: 'Failed to fetch trip summary' });
  } finally {
    db.release();
  }
};

module.exports = {
  createTrip,
  stopTrip,
  getTripById,
  getTrips,
  getTripSummary,
};
