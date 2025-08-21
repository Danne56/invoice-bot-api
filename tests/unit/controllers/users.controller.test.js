const {
  createUser,
  getUserByPhoneNumber,
  getUserStatus,
  markIntroSent,
  resetIntroFlags,
} = require('../../../src/controllers/users.controller');
const pool = require('../../../src/utils/db');
const idGenerator = require('../../../src/utils/idGenerator');
const logger = require('../../../src/utils/logger');

// Mock dependencies
jest.mock('../../../src/utils/db');
jest.mock('../../../src/utils/idGenerator');
jest.mock('../../../src/utils/logger');

describe('Users Controller', () => {
  let req, res, db;

  beforeEach(() => {
    req = {
      body: {},
      params: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    db = {
      execute: jest.fn(),
      release: jest.fn(),
      rollback: jest.fn(),
      commit: jest.fn(),
      beginTransaction: jest.fn(),
    };
    pool.getConnection.mockResolvedValue(db);
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create a new user and return 201', async () => {
      req.body.phoneNumber = '6281234567890';
      const mockUserId = 'mock-user-id';
      const mockUser = {
        id: mockUserId,
        phone_number: '6281234567890',
        is_active: 0,
        current_trip_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      idGenerator.generateId.mockReturnValue(mockUserId);
      db.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[mockUser]]);

      await createUser(req, res);

      expect(db.beginTransaction).toHaveBeenCalled();
      expect(idGenerator.generateId).toHaveBeenCalledWith(12);
      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(db.commit).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        user: {
          userId: mockUser.id,
          phoneNumber: mockUser.phone_number,
          isActive: Boolean(mockUser.is_active),
          currentTripId: mockUser.current_trip_id,
          createdAt: mockUser.created_at,
          updatedAt: mockUser.updated_at,
        },
        message: 'User ensured/created successfully',
      });
    });

    it('should update existing user and return 201', async () => {
      req.body.phoneNumber = '6281234567890';
      const mockUser = {
        id: 'existing-user-id',
        phone_number: '6281234567890',
        is_active: 1,
        current_trip_id: 'trip-123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Simulate user already exists, so INSERT...ON DUPLICATE KEY UPDATE runs update path
      db.execute
        .mockResolvedValueOnce([{ affectedRows: 2 }])
        .mockResolvedValueOnce([[mockUser]]);

      await createUser(req, res);

      expect(db.beginTransaction).toHaveBeenCalled();
      expect(idGenerator.generateId).toHaveBeenCalledWith(12); // Still called, but not used for existing user
      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(db.commit).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        user: {
          userId: mockUser.id,
          phoneNumber: mockUser.phone_number,
          isActive: true,
          currentTripId: 'trip-123',
          createdAt: mockUser.created_at,
          updatedAt: mockUser.updated_at,
        },
        message: 'User ensured/created successfully',
      });
    });

    it('should handle database errors and return 500', async () => {
      req.body.phoneNumber = '6281234567890';
      const error = new Error('Database error');
      db.execute.mockRejectedValue(error);

      await createUser(req, res);

      expect(db.beginTransaction).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to create user' });
      expect(db.rollback).toHaveBeenCalled();
      expect(db.commit).not.toHaveBeenCalled();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getUserByPhoneNumber', () => {
    it('should return user data for a valid phone number with IDR currency', async () => {
      req.params.phoneNumber = '6281234567890';
      const mockUser = {
        id: 'user-123',
        phone_number: '6281234567890',
        is_active: 1,
        current_trip_id: 'trip-123',
        event_name: 'Business Trip',
        started_at: '2023-01-01T00:00:00.000Z',
        total_amount: '100000',
        current_trip_currency: 'IDR',
      };
      db.execute.mockResolvedValue([[mockUser]]);

      await getUserByPhoneNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          amount: 100000,
          displayAmount: 'Rp100.000',
        }),
      });
    });

    it('should return user data for a valid phone number with USD currency', async () => {
      req.params.phoneNumber = '6281234567890';
      const mockUser = {
        id: 'user-123',
        phone_number: '6281234567890',
        is_active: 1,
        current_trip_id: 'trip-123',
        event_name: 'Business Trip',
        started_at: '2023-01-01T00:00:00.000Z',
        total_amount: '50000', // 500.00 USD
        current_trip_currency: 'USD',
      };
      db.execute.mockResolvedValue([[mockUser]]);

      await getUserByPhoneNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          amount: 500,
          displayAmount: '$ 500.00',
        }),
      });
    });

    it('should return user data without trip details if no active trip', async () => {
      req.params.phoneNumber = '6281234567890';
      const mockUser = {
        id: 'user-123',
        phone_number: '6281234567890',
        is_active: 0,
        current_trip_id: null,
        event_name: null,
        started_at: null,
        total_amount: null,
        current_trip_currency: null,
      };
      db.execute.mockResolvedValue([[mockUser]]);

      await getUserByPhoneNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseData = res.json.mock.calls[0][0].data;
      expect(responseData.userId).toBe('user-123');
      expect(responseData.amount).toBeUndefined();
      expect(responseData.displayAmount).toBeUndefined();
    });

    it('should return 404 if user not found', async () => {
      req.params.phoneNumber = '6281234567890';
      db.execute.mockResolvedValue([[]]);

      await getUserByPhoneNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('should handle database errors and return 500', async () => {
      req.params.phoneNumber = '6281234567890';
      const error = new Error('Database error');
      db.execute.mockRejectedValue(error);

      await getUserByPhoneNumber(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch user' });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getUserStatus', () => {
    it('should return user status with an active trip in USD', async () => {
      req.params.phoneNumber = '6281234567890';
      const mockStatus = {
        id: 'user-123',
        is_active: 1,
        intro_sent_today: 0,
        trip_id: 'trip-123',
        event_name: 'Business Trip',
        started_at: '2023-01-01T00:00:00.000Z',
        total_amount: '50000',
        currency: 'USD',
        transaction_count: '2',
      };
      db.execute.mockResolvedValue([[mockStatus]]);

      await getUserStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        userId: 'user-123',
        isActive: true,
        introSentToday: false,
        currentTrip: {
          tripId: 'trip-123',
          eventName: 'Business Trip',
          startedAt: '2023-01-01T00:00:00.000Z',
          currency: 'USD',
          amount: 500,
          displayAmount: '$ 500.00',
          transactionCount: 2,
        },
      });
    });

    it('should return user status with an active trip in IDR', async () => {
      req.params.phoneNumber = '6281234567890';
      const mockStatus = {
        id: 'user-456',
        is_active: 1,
        intro_sent_today: 0,
        trip_id: 'trip-456',
        event_name: 'Holiday Trip',
        started_at: '2023-02-01T00:00:00.000Z',
        total_amount: '1500000',
        currency: 'IDR',
        transaction_count: '5',
      };
      db.execute.mockResolvedValue([[mockStatus]]);

      await getUserStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        userId: 'user-456',
        isActive: true,
        introSentToday: false,
        currentTrip: {
          tripId: 'trip-456',
          eventName: 'Holiday Trip',
          startedAt: '2023-02-01T00:00:00.000Z',
          currency: 'IDR',
          amount: 1500000,
          displayAmount: 'Rp1.500.000',
          transactionCount: 5,
        },
      });
    });

    it('should return user status with no active trip', async () => {
      req.params.phoneNumber = '6281234567890';
      const mockStatus = {
        id: 'user-789',
        is_active: 0,
        intro_sent_today: 0,
        trip_id: null,
      };
      db.execute.mockResolvedValue([[mockStatus]]);

      await getUserStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        userId: 'user-789',
        isActive: false,
        introSentToday: false,
        currentTrip: null,
      });
    });

    it('should return 404 if user not found', async () => {
      req.params.phoneNumber = '6281234567890';
      db.execute.mockResolvedValue([[]]);

      await getUserStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('should handle database errors and return 500', async () => {
      req.params.phoneNumber = '6281234567890';
      const error = new Error('Database error');
      db.execute.mockRejectedValue(error);

      await getUserStatus(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to fetch user status',
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('markIntroSent', () => {
    it('should mark intro as sent and return 200', async () => {
      req.params.userId = 'user-123';
      const mockUser = [{ id: 'user-123' }];
      const mockResult = { affectedRows: 1 };

      db.execute
        .mockResolvedValueOnce([mockUser])
        .mockResolvedValueOnce([mockResult]);

      await markIntroSent(req, res);

      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(db.execute).toHaveBeenCalledWith(
        'SELECT id FROM users WHERE id = ?',
        ['user-123']
      );
      expect(db.execute).toHaveBeenCalledWith(
        'UPDATE users SET intro_sent_today = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['user-123']
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(logger.info).toHaveBeenCalledWith({
        message: 'Intro marked as sent for user user-123',
      });
    });

    it('should return 404 if user not found', async () => {
      req.params.userId = 'nonexistent-user';
      db.execute.mockResolvedValueOnce([[]]);

      await markIntroSent(req, res);

      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('should return 404 if update affects no rows', async () => {
      req.params.userId = 'user-123';
      const mockUser = [{ id: 'user-123' }];
      const mockResult = { affectedRows: 0 };

      db.execute
        .mockResolvedValueOnce([mockUser])
        .mockResolvedValueOnce([mockResult]);

      await markIntroSent(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('should handle database errors and return 500', async () => {
      req.params.userId = 'user-123';
      const error = new Error('Database error');
      db.execute.mockRejectedValue(error);

      await markIntroSent(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to update intro status',
      });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'DB Error (mark intro sent)',
        error: error.message,
      });
    });
  });

  describe('resetIntroFlags', () => {
    it('should reset intro flags and return 200', async () => {
      const mockResult = { affectedRows: 5 };
      db.execute.mockResolvedValueOnce([mockResult]);

      await resetIntroFlags(req, res);

      expect(db.execute).toHaveBeenCalledWith(
        'UPDATE users SET intro_sent_today = 0, updated_at = CURRENT_TIMESTAMP WHERE intro_sent_today = 1'
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Reset intro flags for 5 users',
      });
      expect(logger.info).toHaveBeenCalledWith({
        message: 'Intro flags reset successfully',
        affectedRows: 5,
      });
    });

    it('should handle case when no users need flag reset', async () => {
      const mockResult = { affectedRows: 0 };
      db.execute.mockResolvedValueOnce([mockResult]);

      await resetIntroFlags(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Reset intro flags for 0 users',
      });
      expect(logger.info).toHaveBeenCalledWith({
        message: 'Intro flags reset successfully',
        affectedRows: 0,
      });
    });

    it('should handle database errors and return 500', async () => {
      const error = new Error('Database error');
      db.execute.mockRejectedValue(error);

      await resetIntroFlags(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to reset intro flags',
      });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'DB Error (reset intro)',
        error: error.message,
      });
    });
  });
});
