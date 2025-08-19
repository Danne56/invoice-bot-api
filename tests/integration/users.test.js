const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/utils/db');

// Mock database connection
jest.mock('../../src/utils/db');

describe('Users API', () => {
  const API_KEY = process.env.API_KEY || 'test-api-key';
  const VALID_PHONE_NUMBER = '6281234567890'; // Valid Indonesian phone number

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('POST /api/users', () => {
    it('should create a new user with valid phone number', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        release: jest.fn(),
      };

      const mockUser = {
        id: 'mocked-id-123456789012',
        phone_number: VALID_PHONE_NUMBER,
        is_active: 0,
        current_trip_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);
      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT
        .mockResolvedValueOnce([[mockUser]]); // SELECT

      const response = await request(app)
        .post('/api/users')
        .set('X-API-Key', API_KEY)
        .send({ phoneNumber: VALID_PHONE_NUMBER })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty(
        'phoneNumber',
        VALID_PHONE_NUMBER
      );
      expect(response.body.user).toHaveProperty('isActive', false);
      expect(response.body.user).toHaveProperty('currentTripId', null);
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    });

    it('should return 422 for invalid phone number', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('X-API-Key', API_KEY)
        .send({ phoneNumber: 'invalid-phone' })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 when phone number is missing', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('X-API-Key', API_KEY)
        .send({})
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      const mockConnection = {
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
        rollback: jest.fn(),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post('/api/users')
        .set('X-API-Key', API_KEY)
        .send({ phoneNumber: VALID_PHONE_NUMBER })
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Failed to create user');
    });
  });

  describe('GET /api/users/:phoneNumber', () => {
    it('should return user information for valid phone number', async () => {
      const mockUser = {
        id: 'user-123',
        phone_number: VALID_PHONE_NUMBER,
        is_active: 1,
        current_trip_id: 'trip-123',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        current_trip_name: 'Business Trip',
        trip_started_at: '2023-01-01T00:00:00.000Z',
        total_amount: '100000',
        current_trip_currency: 'IDR',
      };

      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[mockUser]]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/users/${VALID_PHONE_NUMBER}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('id', 'user-123');
      expect(response.body.data).toHaveProperty(
        'phone_number',
        VALID_PHONE_NUMBER
      );
    });

    it('should return 404 for non-existent user', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[]]), // Empty result
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/users/${VALID_PHONE_NUMBER}`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'User not found');
    });

    it('should return 422 for invalid phone number format', async () => {
      const response = await request(app)
        .get('/api/users/invalid-phone')
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
        .get(`/api/users/${VALID_PHONE_NUMBER}`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Failed to fetch user');
    });
  });

  describe('GET /api/users/:phoneNumber/status', () => {
    it('should return user status for valid phone number', async () => {
      const mockStatus = {
        is_active: 1,
        trip_id: 'trip-123',
        event_name: 'Business Trip',
        started_at: '2023-01-01T00:00:00.000Z',
        total_amount: '100000',
        currency: 'IDR',
        transaction_count: '5',
      };

      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[mockStatus]]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/users/${VALID_PHONE_NUMBER}/status`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('isActive', true);
      expect(response.body).toHaveProperty('currentTrip');
      expect(response.body.currentTrip).toHaveProperty('tripId', 'trip-123');
      expect(response.body.currentTrip).toHaveProperty(
        'eventName',
        'Business Trip'
      );
    });

    it('should return user status with no active trip', async () => {
      const mockStatus = {
        is_active: 0,
        trip_id: null,
        event_name: null,
        started_at: null,
        total_amount: null,
        currency: null,
        transaction_count: '0',
      };

      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[mockStatus]]),
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/users/${VALID_PHONE_NUMBER}/status`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('isActive', false);
      expect(response.body).toHaveProperty('currentTrip', null);
    });

    it('should return 404 for non-existent user', async () => {
      const mockConnection = {
        execute: jest.fn().mockResolvedValue([[]]), // Empty result
        release: jest.fn(),
      };

      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .get(`/api/users/${VALID_PHONE_NUMBER}/status`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'User not found');
    });

    it('should return 422 for invalid phone number format', async () => {
      const response = await request(app)
        .get('/api/users/invalid-phone/status')
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
        .get(`/api/users/${VALID_PHONE_NUMBER}/status`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty(
        'error',
        'Failed to fetch user status'
      );
    });
  });
});
