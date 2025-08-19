const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/utils/db');

// Mock database connection
jest.mock('../../src/utils/db');

describe('Transactions API', () => {
  const API_KEY = process.env.API_KEY || 'test-api-key';
  const VALID_PHONE_NUMBER = '6281234567890'; // Valid Indonesian phone number
  const VALID_TRIP_ID = 'trip12345678'; // 12 characters
  const VALID_TRANSACTION_ID = 'tx1234567890'; // 12 characters
  const VALID_MERCHANT = 'Starbucks Jakarta';

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('POST /api/transactions', () => {
    it('should create a new transaction with valid data (IDR)', async () => {
      const mockConnection = {
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses
      mockConnection.execute
        .mockResolvedValueOnce([
          [
            {
              id: VALID_TRIP_ID,
              status: 'active',
              event_name: 'Business Trip',
              currency: 'IDR',
            },
          ],
        ]) // Trip exists and is active
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Insert transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update trip currency (if needed)

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          date: '2023-01-01',
          subtotal: 80000,
          taxAmount: 20000,
          itemCount: 3,
          itemSummary: 'Coffee, Sandwich, Salad',
          currency: 'IDR',
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('transactionId');
      expect(response.body).toHaveProperty('tripId', VALID_TRIP_ID);
      expect(response.body).toHaveProperty('currency', 'IDR');
      expect(response.body).toHaveProperty('amount', 100000);
      expect(response.body).toHaveProperty('displayAmount');
      expect(response.body).toHaveProperty('merchant', VALID_MERCHANT);
      expect(response.body).toHaveProperty('message');
    });

    it('should create a new transaction with valid data (USD)', async () => {
      const mockConnection = {
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses
      mockConnection.execute
        .mockResolvedValueOnce([
          [
            {
              id: VALID_TRIP_ID,
              status: 'active',
              event_name: 'Business Trip',
              currency: 'USD',
            },
          ],
        ]) // Trip exists and is active
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Insert transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update trip currency (if needed)

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100.5,
          merchant: VALID_MERCHANT,
          date: '2023-01-01',
          subtotal: 80.25,
          taxAmount: 20.25,
          itemCount: 3,
          itemSummary: 'Coffee, Sandwich, Salad',
          currency: 'USD',
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('currency', 'USD');
      expect(response.body).toHaveProperty('amount', 100.5);
    });

    it('should create a new transaction with default currency (IDR)', async () => {
      const mockConnection = {
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses
      mockConnection.execute
        .mockResolvedValueOnce([
          [
            {
              id: VALID_TRIP_ID,
              status: 'active',
              event_name: 'Business Trip',
              currency: null, // No currency set yet
            },
          ],
        ]) // Trip exists and is active
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Insert transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update trip currency

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
        })
        .expect(201);

      expect(response.body).toHaveProperty('currency', 'IDR');
    });

    it('should return 404 for non-existent trip', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No trip found
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
        })
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Trip not found');
    });

    it('should return 400 for completed trip', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([
          [
            {
              id: VALID_TRIP_ID,
              status: 'completed',
              event_name: 'Business Trip',
              currency: 'IDR',
            },
          ],
        ]), // Trip exists but completed
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
        })
        .expect(400);

      expect(response.body).toHaveProperty(
        'error',
        'Cannot add transactions to a completed trip'
      );
    });

    it('should return 400 for currency mismatch', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([
          [
            {
              id: VALID_TRIP_ID,
              status: 'active',
              event_name: 'Business Trip',
              currency: 'USD', // Trip currency is USD
            },
          ],
        ]), // Trip exists with USD currency
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          currency: 'IDR', // Trying to create IDR transaction
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain(
        'Trip currency (USD) does not match transaction currency (IDR)'
      );
    });

    it('should return 422 for invalid trip ID format (too short)', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: 'invalid',
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid trip ID format (too long)', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: 'thisistoolongforatripid123456',
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid currency', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          currency: 'EUR',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid total amount (IDR with decimals)', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000.5, // Decimal not allowed for IDR
          merchant: VALID_MERCHANT,
          currency: 'IDR',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid total amount (USD with too many decimals)', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100.555, // More than 2 decimals not allowed for USD
          merchant: VALID_MERCHANT,
          currency: 'USD',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for negative total amount', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: -100000,
          merchant: VALID_MERCHANT,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for zero total amount', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 0,
          merchant: VALID_MERCHANT,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid merchant name (too long)', async () => {
      const longMerchant = 'A'.repeat(150);
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: longMerchant,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid date format', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          date: 'invalid-date',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid subtotal (negative)', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          subtotal: -50000,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid tax amount (negative)', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          taxAmount: -20000,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid item count (zero)', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          itemCount: 0,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid item summary (too long)', async () => {
      const longSummary = 'A'.repeat(6000);
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          itemSummary: longSummary,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const mockConnection = {
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
        })
        .expect(500);

      expect(response.body).toHaveProperty(
        'error',
        'Failed to record transaction'
      );
    });
  });

  describe('GET /api/transactions/:transactionId', () => {
    it('should return transaction details', async () => {
      const mockTransaction = {
        id: VALID_TRANSACTION_ID,
        trip_id: VALID_TRIP_ID,
        currency: 'IDR',
        merchant: VALID_MERCHANT,
        date: '2023-01-01',
        total_amount: '100000',
        subtotal: '80000',
        tax_amount: '20000',
        item_count: 3,
        item_summary: 'Coffee, Sandwich, Salad',
        recorded_at: '2023-01-01T12:00:00.000Z',
        event_name: 'Business Trip',
        phone_number: VALID_PHONE_NUMBER,
      };

      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[mockTransaction]]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/transactions/${VALID_TRANSACTION_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('id', VALID_TRANSACTION_ID);
      expect(response.body.data).toHaveProperty('trip_id', VALID_TRIP_ID);
      expect(response.body.data).toHaveProperty('currency', 'IDR');
      expect(response.body.data).toHaveProperty('merchant', VALID_MERCHANT);
      expect(response.body.data).toHaveProperty('amount', 100000);
      expect(response.body.data).toHaveProperty('displayAmount');
    });

    it('should return 404 for non-existent transaction', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No transaction found
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/transactions/${VALID_TRANSACTION_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Transaction not found');
    });

    it('should return 422 for invalid transaction ID format (too short)', async () => {
      const response = await request(app)
        .get('/api/transactions/invalid')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid transaction ID format (too long)', async () => {
      const response = await request(app)
        .get('/api/transactions/thisistoolongforatransactionid123456')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const mockConnection = {
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/transactions/${VALID_TRANSACTION_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty(
        'error',
        'Failed to fetch transaction'
      );
    });
  });

  describe('GET /api/transactions', () => {
    it('should return transactions with default pagination', async () => {
      const mockTransactions = [
        {
          id: 'tx1234567890',
          trip_id: VALID_TRIP_ID,
          currency: 'IDR',
          merchant: 'Starbucks',
          date: '2023-01-01',
          total_amount: '100000',
          subtotal: '80000',
          tax_amount: '20000',
          item_count: 3,
          item_summary: 'Coffee, Sandwich, Salad',
          recorded_at: '2023-01-01T12:00:00.000Z',
          event_name: 'Business Trip',
          phone_number: VALID_PHONE_NUMBER,
        },
        {
          id: 'tx0987654321',
          trip_id: VALID_TRIP_ID,
          currency: 'USD',
          merchant: 'McDonalds',
          date: '2023-01-02',
          total_amount: '5000',
          subtotal: '4000',
          tax_amount: '1000',
          item_count: 2,
          item_summary: 'Burger, Fries',
          recorded_at: '2023-01-02T12:00:00.000Z',
          event_name: 'Business Trip',
          phone_number: VALID_PHONE_NUMBER,
        },
      ];

      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([mockTransactions]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get('/api/transactions')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('limit', 20);
      expect(response.body.pagination).toHaveProperty('offset', 0);
    });

    it('should return transactions filtered by trip ID', async () => {
      const mockTransactions = [
        {
          id: 'tx1234567890',
          trip_id: VALID_TRIP_ID,
          currency: 'IDR',
          merchant: 'Starbucks',
          date: '2023-01-01',
          total_amount: '100000',
          subtotal: '80000',
          tax_amount: '20000',
          item_count: 3,
          item_summary: 'Coffee, Sandwich, Salad',
          recorded_at: '2023-01-01T12:00:00.000Z',
          event_name: 'Business Trip',
          phone_number: VALID_PHONE_NUMBER,
        },
      ];

      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([mockTransactions]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/transactions?tripId=${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body.data[0]).toHaveProperty('trip_id', VALID_TRIP_ID);
    });

    it('should return transactions filtered by merchant', async () => {
      const mockTransactions = [
        {
          id: 'tx1234567890',
          trip_id: VALID_TRIP_ID,
          currency: 'IDR',
          merchant: VALID_MERCHANT,
          date: '2023-01-01',
          total_amount: '100000',
          subtotal: '80000',
          tax_amount: '20000',
          item_count: 3,
          item_summary: 'Coffee, Sandwich, Salad',
          recorded_at: '2023-01-01T12:00:00.000Z',
          event_name: 'Business Trip',
          phone_number: VALID_PHONE_NUMBER,
        },
      ];

      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([mockTransactions]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/transactions?merchant=${encodeURIComponent(VALID_MERCHANT)}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body.data[0]).toHaveProperty('merchant', VALID_MERCHANT);
    });

    it('should return transactions filtered by date range', async () => {
      const mockTransactions = [
        {
          id: 'tx1234567890',
          trip_id: VALID_TRIP_ID,
          currency: 'IDR',
          merchant: VALID_MERCHANT,
          date: '2023-01-15',
          total_amount: '100000',
          subtotal: '80000',
          tax_amount: '20000',
          item_count: 3,
          item_summary: 'Coffee, Sandwich, Salad',
          recorded_at: '2023-01-15T12:00:00.000Z',
          event_name: 'Business Trip',
          phone_number: VALID_PHONE_NUMBER,
        },
      ];

      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([mockTransactions]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get('/api/transactions?dateFrom=2023-01-01&dateTo=2023-01-31')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });

    it('should return transactions with custom pagination', async () => {
      const mockTransactions = [
        {
          id: 'tx1234567890',
          trip_id: VALID_TRIP_ID,
          currency: 'IDR',
          merchant: VALID_MERCHANT,
          date: '2023-01-01',
          total_amount: '100000',
          subtotal: '80000',
          tax_amount: '20000',
          item_count: 3,
          item_summary: 'Coffee, Sandwich, Salad',
          recorded_at: '2023-01-01T12:00:00.000Z',
          event_name: 'Business Trip',
          phone_number: VALID_PHONE_NUMBER,
        },
      ];

      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([mockTransactions]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get('/api/transactions?limit=5&offset=10')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body.pagination).toHaveProperty('limit', 5);
      expect(response.body.pagination).toHaveProperty('offset', 10);
    });

    it('should return 422 for invalid trip ID format', async () => {
      const response = await request(app)
        .get('/api/transactions?tripId=invalid')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid merchant filter (too long)', async () => {
      const longMerchant = 'A'.repeat(150);
      const response = await request(app)
        .get(`/api/transactions?merchant=${encodeURIComponent(longMerchant)}`)
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid dateFrom format', async () => {
      const response = await request(app)
        .get('/api/transactions?dateFrom=invalid-date')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid dateTo format', async () => {
      const response = await request(app)
        .get('/api/transactions?dateTo=invalid-date')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should create a transaction with zero subtotal and tax', async () => {
      const mockConnection = {
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses
      mockConnection.execute
        .mockResolvedValueOnce([
          [
            {
              id: VALID_TRIP_ID,
              status: 'active',
              event_name: 'Business Trip',
              currency: 'IDR',
            },
          ],
        ]) // Trip exists and is active
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Insert transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update trip currency (if needed)

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          subtotal: 0, // Zero subtotal
          taxAmount: 0, // Zero tax
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should create a transaction with all optional fields missing', async () => {
      const mockConnection = {
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses
      mockConnection.execute
        .mockResolvedValueOnce([
          [
            {
              id: VALID_TRIP_ID,
              status: 'active',
              event_name: 'Business Trip',
              currency: 'IDR',
            },
          ],
        ]) // Trip exists and is active
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Insert transaction
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update trip currency (if needed)

      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 100000,
          merchant: VALID_MERCHANT,
          // All optional fields missing: date, subtotal, taxAmount, itemCount, itemSummary
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should return 422 for USD transaction with zero total amount', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('X-API-Key', API_KEY)
        .send({
          tripId: VALID_TRIP_ID,
          totalAmount: 0.0,
          merchant: VALID_MERCHANT,
          currency: 'USD',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid limit (too high)', async () => {
      const response = await request(app)
        .get('/api/transactions?limit=150')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return transactions with maximum valid limit', async () => {
      const mockTransactions = Array.from({ length: 100 }, (_, i) => ({
        id: `tx${i.toString().padStart(10, '0')}`,
        trip_id: VALID_TRIP_ID,
        currency: 'IDR',
        merchant: `Merchant ${i + 1}`,
        date: new Date(Date.now() - i * 86400000).toISOString().split('T')[0], // Different dates
        total_amount: `${(i + 1) * 10000}`,
        subtotal: `${Math.floor((i + 1) * 8000)}`,
        tax_amount: `${Math.floor((i + 1) * 2000)}`,
        item_count: i + 1,
        item_summary: `Item summary ${i + 1}`,
        recorded_at: new Date(Date.now() - i * 3600000).toISOString(), // Different times
        event_name: 'Business Trip',
        phone_number: VALID_PHONE_NUMBER,
      }));

      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([mockTransactions]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get('/api/transactions?limit=100')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(100);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('limit', 100);
    });

    it('should return 422 for invalid offset', async () => {
      const response = await request(app)
        .get('/api/transactions?offset=-1')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const mockConnection = {
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get('/api/transactions')
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty(
        'error',
        'Failed to fetch transactions'
      );
    });
  });
});
