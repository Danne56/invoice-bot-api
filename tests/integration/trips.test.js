const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/utils/db');

// Mock database connection
jest.mock('../../src/utils/db');

describe('Trips API', () => {
  const API_KEY = process.env.API_KEY || 'test-api-key';
  const VALID_PHONE_NUMBER = '6281234567890'; // Valid Indonesian phone number
  const VALID_TRIP_ID = 'trip12345678'; // 12 characters
  const VALID_EVENT_NAME = 'Business Trip to Jakarta';

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('POST /api/trips', () => {
    it('should create a new trip with valid data', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses
      mockConnection.execute
        .mockResolvedValueOnce([[]]) // No active trip
        .mockResolvedValueOnce([[{ id: 'user-123' }]]) // User exists
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Update user
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Create trip
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update user current_trip_id

      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: VALID_EVENT_NAME,
          currency: 'IDR',
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('tripId');
      expect(response.body).toHaveProperty('userId');
      expect(response.body).toHaveProperty('currency', 'IDR');
      expect(response.body).toHaveProperty('eventName', VALID_EVENT_NAME);
      expect(response.body).toHaveProperty('message');
    });

    it('should create a new trip with default currency when not specified', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses
      mockConnection.execute
        .mockResolvedValueOnce([[]]) // No active trip
        .mockResolvedValueOnce([[{ id: 'user-123' }]]) // User exists
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Update user
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Create trip
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update user current_trip_id

      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: VALID_EVENT_NAME,
        })
        .expect(201);

      expect(response.body).toHaveProperty('currency', 'IDR');
    });

    it('should return 400 when user already has an active trip', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses - active trip exists
      mockConnection.execute.mockResolvedValueOnce([
        [{ id: 'active-trip-123' }],
      ]);

      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: VALID_EVENT_NAME,
        })
        .expect(400);

      expect(response.body).toHaveProperty(
        'error',
        'Active trip already exists'
      );
      expect(response.body).toHaveProperty('activeTripId');
    });

    it('should return 404 when user does not exist', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock database responses - no user found
      mockConnection.execute
        .mockResolvedValueOnce([[]]) // No active trip
        .mockResolvedValueOnce([[]]); // No user found

      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: VALID_EVENT_NAME,
        })
        .expect(404);

      expect(response.body).toHaveProperty('error', 'User not found');
    });

    it('should return 422 for invalid phone number', async () => {
      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: 'invalid-phone',
          eventName: VALID_EVENT_NAME,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for missing phone number', async () => {
      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          eventName: VALID_EVENT_NAME,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid event name (too short)', async () => {
      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: '',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid event name (too long)', async () => {
      const longEventName = 'A'.repeat(300);
      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: longEventName,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid currency', async () => {
      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: VALID_EVENT_NAME,
          currency: 'EUR',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post('/api/trips')
        .set('X-API-Key', API_KEY)
        .send({
          phoneNumber: VALID_PHONE_NUMBER,
          eventName: VALID_EVENT_NAME,
        })
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Failed to start trip');
    });
  });

  describe('POST /api/trips/:tripId/stop', () => {
    it('should stop an active trip successfully', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
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
              phone_number: VALID_PHONE_NUMBER,
              event_name: VALID_EVENT_NAME,
              status: 'active',
              currency: 'IDR',
            },
          ],
        ]) // Trip exists and is active
        .mockResolvedValueOnce([[{ total: '100000' }]]) // Transaction sum
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Update trip
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update user

      const response = await request(app)
        .post(`/api/trips/${VALID_TRIP_ID}/stop`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('tripId', VALID_TRIP_ID);
      expect(response.body).toHaveProperty('eventName', VALID_EVENT_NAME);
      expect(response.body).toHaveProperty('currency', 'IDR');
      expect(response.body).toHaveProperty('amount');
      expect(response.body).toHaveProperty('displayAmount');
      expect(response.body).toHaveProperty('message');
    });

    it('should stop a trip with zero total amount', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
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
              phone_number: VALID_PHONE_NUMBER,
              event_name: VALID_EVENT_NAME,
              status: 'active',
              currency: 'IDR',
            },
          ],
        ]) // Trip exists and is active
        .mockResolvedValueOnce([[{ total: '0' }]]) // Transaction sum is zero
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // Update trip
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // Update user

      const response = await request(app)
        .post(`/api/trips/${VALID_TRIP_ID}/stop`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('amount', 0);
      expect(response.body).toHaveProperty('displayAmount');
    });

    it('should return 404 for non-existent trip', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn().mockResolvedValue([[]]), // No trip found
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post(`/api/trips/${VALID_TRIP_ID}/stop`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Trip not found');
    });

    it('should return 400 for already completed trip', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn().mockResolvedValue([
          [
            {
              id: VALID_TRIP_ID,
              status: 'completed',
            },
          ],
        ]), // Trip exists but completed
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post(`/api/trips/${VALID_TRIP_ID}/stop`)
        .set('X-API-Key', API_KEY)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Trip already completed');
    });

    it('should return 422 for invalid trip ID format (too short)', async () => {
      const response = await request(app)
        .post('/api/trips/invalid/stop')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid trip ID format (too long)', async () => {
      const response = await request(app)
        .post('/api/trips/thisistoolongforatripid123456/stop')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const mockConnection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post(`/api/trips/${VALID_TRIP_ID}/stop`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Failed to stop trip');
    });
  });

  describe('GET /api/trips/:tripId', () => {
    it('should return trip details with transactions', async () => {
      const mockTrip = {
        id: VALID_TRIP_ID,
        phone_number: VALID_PHONE_NUMBER,
        event_name: VALID_EVENT_NAME,
        currency: 'IDR',
        started_at: '2023-01-01T00:00:00.000Z',
        ended_at: null,
        total_amount: '100000',
        status: 'active',
      };

      const mockTransactions = [
        {
          id: 'tx1234567890',
          trip_id: VALID_TRIP_ID,
          currency: 'IDR',
          merchant: 'Restaurant',
          date: '2023-01-01',
          total_amount: '50000',
          subtotal: '40000',
          tax_amount: '10000',
          item_count: 2,
          item_summary: 'Food and drinks',
          recorded_at: '2023-01-01T12:00:00.000Z',
        },
      ];

      const mockConnection = {
        execute: jest
          .fn()
          .mockResolvedValueOnce([[mockTrip]]) // Get trip
          .mockResolvedValueOnce([mockTransactions]), // Get transactions
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('id', VALID_TRIP_ID);
      expect(response.body.data).toHaveProperty('event_name', VALID_EVENT_NAME);
      expect(response.body.data).toHaveProperty('transactions');
      expect(Array.isArray(response.body.data.transactions)).toBe(true);
    });

    it('should return 404 for non-existent trip', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[]]), // No trip found
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Trip not found');
    });

    it('should return 422 for invalid trip ID format (too short)', async () => {
      const response = await request(app)
        .get('/api/trips/invalid')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid trip ID format (too long)', async () => {
      const response = await request(app)
        .get('/api/trips/thisistoolongforatripid123456')
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
        .get(`/api/trips/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Failed to fetch trip');
    });
  });

  describe('GET /api/trips', () => {
    it('should return trips for a user', async () => {
      const mockTrips = [
        {
          id: 'trip12345678',
          phone_number: VALID_PHONE_NUMBER,
          event_name: 'Trip 1',
          currency: 'IDR',
          started_at: '2023-01-01T00:00:00.000Z',
          ended_at: null,
          total_amount: '100000',
          status: 'active',
          transaction_count: '2',
        },
        {
          id: 'trip87654321',
          phone_number: VALID_PHONE_NUMBER,
          event_name: 'Trip 2',
          currency: 'USD',
          started_at: '2023-02-01T00:00:00.000Z',
          ended_at: '2023-02-05T00:00:00.000Z',
          total_amount: '5000',
          status: 'completed',
          transaction_count: '1',
        },
      ];

      const mockConnection = {
        execute: jest.fn().mockResolvedValue([mockTrips]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips?phoneNumber=${VALID_PHONE_NUMBER}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body).toHaveProperty('pagination');
    });

    it('should return trips with status filter', async () => {
      const mockTrips = [
        {
          id: 'trip12345678',
          phone_number: VALID_PHONE_NUMBER,
          event_name: 'Active Trip',
          currency: 'IDR',
          started_at: '2023-01-01T00:00:00.000Z',
          ended_at: null,
          total_amount: '100000',
          status: 'active',
          transaction_count: '2',
        },
      ];

      const mockConnection = {
        execute: jest.fn().mockResolvedValue([mockTrips]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips?phoneNumber=${VALID_PHONE_NUMBER}&status=active`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body.data[0]).toHaveProperty('status', 'active');
    });

    it('should return 422 for invalid phone number', async () => {
      const response = await request(app)
        .get('/api/trips?phoneNumber=invalid-phone')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid status filter', async () => {
      const response = await request(app)
        .get(`/api/trips?phoneNumber=${VALID_PHONE_NUMBER}&status=invalid`)
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid limit (too high)', async () => {
      const response = await request(app)
        .get(`/api/trips?phoneNumber=${VALID_PHONE_NUMBER}&limit=150`)
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return trips with maximum valid limit', async () => {
      const mockTrips = Array.from({ length: 100 }, (_, i) => ({
        id: `trip${i.toString().padStart(10, '0')}`,
        phone_number: VALID_PHONE_NUMBER,
        event_name: `Trip ${i + 1}`,
        currency: 'IDR',
        started_at: new Date(Date.now() - i * 86400000).toISOString(), // Different dates
        ended_at: null,
        total_amount: (i + 1) * 10000,
        status: 'active',
        transaction_count: `${i + 1}`,
      }));

      const mockConnection = {
        execute: jest.fn().mockResolvedValue([mockTrips]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips?phoneNumber=${VALID_PHONE_NUMBER}&limit=100`)
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
        .get(`/api/trips?phoneNumber=${VALID_PHONE_NUMBER}&offset=-1`)
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
        .get(`/api/trips?phoneNumber=${VALID_PHONE_NUMBER}`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Failed to fetch trips');
    });
  });

  describe('GET /api/trips/:tripId/summary', () => {
    it('should return trip summary', async () => {
      const mockTrip = {
        id: VALID_TRIP_ID,
        event_name: VALID_EVENT_NAME,
        phone_number: VALID_PHONE_NUMBER,
        started_at: '2023-01-01T00:00:00.000Z',
        ended_at: null,
        total_amount: '100000',
        status: 'active',
      };

      const mockSummary = {
        total_transactions: '2',
        calculated_total: '100000',
        average_expense: '50000',
        min_expense: '30000',
        max_expense: '70000',
        transactions_with_merchant: '2',
      };

      const mockCurrencies = [{ currency: 'IDR' }];

      const mockConnection = {
        execute: jest
          .fn()
          .mockResolvedValueOnce([[mockTrip]]) // Get trip
          .mockResolvedValueOnce([[mockSummary]]) // Get summary
          .mockResolvedValueOnce([mockCurrencies]), // Get currencies
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips/${VALID_TRIP_ID}/summary`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('tripInfo');
      expect(response.body).toHaveProperty('expenseSummary');
      expect(response.body.tripInfo).toHaveProperty('tripId', VALID_TRIP_ID);
      expect(response.body.tripInfo).toHaveProperty(
        'eventName',
        VALID_EVENT_NAME
      );
      expect(response.body.expenseSummary).toHaveProperty(
        'totalTransactions',
        2
      );
    });

    it('should return 404 for non-existent trip', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[]]), // No trip found
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips/${VALID_TRIP_ID}/summary`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Trip not found');
    });

    it('should return 400 for mixed currencies', async () => {
      const mockTrip = {
        id: VALID_TRIP_ID,
        event_name: VALID_EVENT_NAME,
        phone_number: VALID_PHONE_NUMBER,
        started_at: '2023-01-01T00:00:00.000Z',
        ended_at: null,
        total_amount: '100000',
        status: 'active',
        currency: 'IDR',
      };

      const mockCurrencies = [{ currency: 'IDR' }, { currency: 'USD' }]; // Mixed currencies

      const mockConnection = {
        execute: jest
          .fn()
          .mockResolvedValueOnce([[mockTrip]]) // Get trip
          .mockResolvedValueOnce([[{}]]) // Get summary
          .mockResolvedValueOnce([mockCurrencies]), // Get currencies (mixed)
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/trips/${VALID_TRIP_ID}/summary`)
        .set('X-API-Key', API_KEY)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('details');
    });

    it('should return 422 for invalid trip ID format (too short)', async () => {
      const response = await request(app)
        .get('/api/trips/invalid/summary')
        .set('X-API-Key', API_KEY)
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid trip ID format (too long)', async () => {
      const response = await request(app)
        .get('/api/trips/thisistoolongforatripid123456/summary')
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
        .get(`/api/trips/${VALID_TRIP_ID}/summary`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty(
        'error',
        'Failed to fetch trip summary'
      );
    });
  });
});
