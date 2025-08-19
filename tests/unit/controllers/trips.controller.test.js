const {
  createTrip,
  stopTrip,
  getTripById,
  getTrips,
  getTripSummary,
} = require('../../../src/controllers/trips.controller');
const pool = require('../../../src/utils/db');
const idGenerator = require('../../../src/utils/idGenerator');
const logger = require('../../../src/utils/logger');

// Mock dependencies
jest.mock('../../../src/utils/db');
jest.mock('../../../src/utils/idGenerator');
jest.mock('../../../src/utils/logger');

describe('Trips Controller', () => {
  let req, res, db;

  beforeEach(() => {
    req = {
      body: {},
      params: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    db = {
      execute: jest.fn(),
      release: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    pool.getConnection.mockResolvedValue(db);
    jest.clearAllMocks();
  });

  describe('createTrip', () => {
    it('should create a new trip with specified currency and return 201', async () => {
      req.body = {
        phoneNumber: '6281234567890',
        eventName: 'Business Trip',
        currency: 'USD',
      };
      const mockTripId = 'mock-trip-id';
      const mockUserId = 'mock-user-id';

      idGenerator.generateId.mockReturnValue(mockTripId);
      db.execute
        .mockResolvedValueOnce([[]]) // No active trip
        .mockResolvedValueOnce([[{ id: mockUserId }]]) // User exists
        .mockResolvedValue([[{ affectedRows: 1 }]]); // All other queries succeed

      await createTrip(req, res);

      expect(db.beginTransaction).toHaveBeenCalled();
      expect(idGenerator.generateId).toHaveBeenCalledWith(12);
      expect(db.execute).toHaveBeenCalledTimes(5);
      expect(db.commit).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        tripId: mockTripId,
        userId: mockUserId,
        currency: 'USD',
        eventName: 'Business Trip',
        message: "Trip 'Business Trip' started (currency: USD)",
      });
    });

    it('should create a new trip with default IDR currency if not specified', async () => {
      req.body = {
        phoneNumber: '6281234567890',
        eventName: 'Holiday Trip',
      };
      const mockTripId = 'mock-trip-id-2';
      const mockUserId = 'mock-user-id-2';

      idGenerator.generateId.mockReturnValue(mockTripId);
      db.execute
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ id: mockUserId }]])
        .mockResolvedValue([[{ affectedRows: 1 }]]);

      await createTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        tripId: mockTripId,
        userId: mockUserId,
        currency: 'IDR', // Default currency
        eventName: 'Holiday Trip',
        message: "Trip 'Holiday Trip' started (currency: IDR)",
      });
    });

    it('should return 400 if an active trip already exists', async () => {
      req.body = { phoneNumber: '6281234567890' };
      db.execute.mockResolvedValueOnce([[{ id: 'active-trip' }]]);

      await createTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Active trip already exists',
        activeTripId: 'active-trip',
      });
      expect(db.rollback).toHaveBeenCalled();
    });

    it('should return 404 if user not found', async () => {
      req.body = { phoneNumber: '6281234567890' };
      db.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);

      await createTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'User not found',
        message: 'User must be created first before starting a trip',
        phoneNumber: '6281234567890',
      });
      expect(db.rollback).toHaveBeenCalled();
    });

    it('should handle database errors and return 500', async () => {
      req.body = { phoneNumber: '6281234567890' };
      const error = new Error('Database error');
      db.execute.mockRejectedValue(error);

      await createTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to start trip' });
      expect(db.rollback).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('stopTrip', () => {
    it('should stop an active trip with IDR currency and return 200', async () => {
      req.params.tripId = 'trip-123';
      const mockTrip = {
        id: 'trip-123',
        phone_number: '6281234567890',
        event_name: 'Business Trip',
        status: 'active',
        currency: 'IDR',
      };
      const mockSum = [{ total: '150000' }];

      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockSum])
        .mockResolvedValue([[{ affectedRows: 1 }]]);

      await stopTrip(req, res);

      expect(db.beginTransaction).toHaveBeenCalled();
      expect(db.execute).toHaveBeenCalledTimes(4);
      expect(db.commit).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        tripId: 'trip-123',
        eventName: 'Business Trip',
        currency: 'IDR',
        amount: 150000,
        displayAmount: 'Rp150.000',
        message: "Trip 'Business Trip' completed with total expense: Rp150.000",
      });
    });

    it('should stop an active trip with USD currency and return 200', async () => {
      req.params.tripId = 'trip-456';
      const mockTrip = {
        id: 'trip-456',
        phone_number: '6281234567891',
        event_name: 'US Conference',
        status: 'active',
        currency: 'USD',
      };
      const mockSum = [{ total: '75050' }]; // 750.50 USD

      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockSum])
        .mockResolvedValue([[{ affectedRows: 1 }]]);

      await stopTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        tripId: 'trip-456',
        eventName: 'US Conference',
        currency: 'USD',
        amount: 750.5,
        displayAmount: '$ 750.50',
        message: "Trip 'US Conference' completed with total expense: $ 750.50",
      });
    });

    it('should stop a trip with zero transactions', async () => {
      req.params.tripId = 'trip-789';
      const mockTrip = {
        id: 'trip-789',
        phone_number: '6281234567892',
        event_name: 'Empty Trip',
        status: 'active',
        currency: 'IDR',
      };
      const mockSum = [{ total: '0' }];

      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockSum])
        .mockResolvedValue([[{ affectedRows: 1 }]]);

      await stopTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 0, displayAmount: 'Rp0' })
      );
    });

    it('should return 404 if trip not found', async () => {
      req.params.tripId = 'trip-123';
      db.execute.mockResolvedValue([[]]);

      await stopTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Trip not found' });
      expect(db.rollback).toHaveBeenCalled();
    });

    it('should return 400 if trip is already completed', async () => {
      req.params.tripId = 'trip-123';
      const mockTrip = { status: 'completed' };
      db.execute.mockResolvedValue([[mockTrip]]);

      await stopTrip(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Trip already completed',
      });
      expect(db.rollback).toHaveBeenCalled();
    });
  });

  describe('getTripById', () => {
    it('should return trip details with transactions in IDR', async () => {
      req.params.tripId = 'trip-123';
      const mockTrip = {
        id: 'trip-123',
        total_amount: '100000',
        currency: 'IDR',
      };
      const mockTransactions = [
        { id: 'tx-1', total_amount: '50000', currency: 'IDR' },
      ];
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockTransactions]);

      await getTripById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseData = res.json.mock.calls[0][0].data;
      expect(responseData.id).toBe('trip-123');
      expect(responseData.amount).toBe(100000);
      expect(responseData.displayAmount).toBe('Rp100.000');
      expect(responseData.transactions[0].amount).toBe(50000);
      expect(responseData.transactions[0].displayAmount).toBe('Rp50.000');
    });

    it('should return trip details with transactions in USD', async () => {
      req.params.tripId = 'trip-456';
      const mockTrip = {
        id: 'trip-456',
        total_amount: '75050',
        currency: 'USD',
      };
      const mockTransactions = [
        { id: 'tx-2', total_amount: '25025', currency: 'USD' },
      ];
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockTransactions]);

      await getTripById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseData = res.json.mock.calls[0][0].data;
      expect(responseData.amount).toBe(750.5);
      expect(responseData.displayAmount).toBe('$ 750.50');
      expect(responseData.transactions[0].amount).toBe(250.25);
      expect(responseData.transactions[0].displayAmount).toBe('$ 250.25');
    });

    it('should return trip details with no transactions', async () => {
      req.params.tripId = 'trip-789';
      const mockTrip = { id: 'trip-789', total_amount: '0', currency: 'IDR' };
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([[]]);

      await getTripById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 'trip-789', transactions: [] }),
      });
    });

    it('should return 404 if trip not found', async () => {
      req.params.tripId = 'non-existent-trip';
      db.execute.mockResolvedValue([[]]);

      await getTripById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Trip not found' });
    });
  });

  describe('getTrips', () => {
    it('should return a list of trips for a user', async () => {
      req.query = { phoneNumber: '6281234567890', limit: 10, offset: 0 };
      const mockTrips = [
        {
          id: 'trip-1',
          total_amount: '50000',
          currency: 'IDR',
          transaction_count: '1',
        },
        {
          id: 'trip-2',
          total_amount: '25000',
          currency: 'USD',
          transaction_count: '2',
        },
      ];
      db.execute.mockResolvedValue([mockTrips]);

      await getTrips(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseData = res.json.mock.calls[0][0].data;
      expect(responseData.length).toBe(2);
      expect(responseData[0].displayAmount).toBe('Rp50.000');
      expect(responseData[1].displayAmount).toBe('$ 250.00');
      expect(res.json.mock.calls[0][0].pagination).toEqual({
        limit: 10,
        offset: 0,
      });
    });

    it('should filter trips by status', async () => {
      req.query = {
        phoneNumber: '6281234567890',
        status: 'completed',
        limit: 5,
        offset: 0,
      };
      db.execute.mockResolvedValue([[]]);

      await getTrips(req, res);

      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('AND t.status = ?'),
        ['6281234567890', 'completed', 5, 0]
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return an empty list if no trips are found', async () => {
      req.query = { phoneNumber: 'non-existent-user' };
      db.execute.mockResolvedValue([[]]);

      await getTrips(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [],
        pagination: { limit: 10, offset: 0 },
      });
    });
  });

  describe('getTripSummary', () => {
    it('should return a trip summary for an IDR trip', async () => {
      req.params.tripId = 'trip-123';
      const mockTrip = {
        id: 'trip-123',
        currency: 'IDR',
        total_amount: '100000',
      };
      const mockSummary = [
        {
          total_transactions: '2',
          calculated_total: '100000',
          average_expense: '50000',
          min_expense: '40000',
          max_expense: '60000',
        },
      ];
      const mockCurrencies = [{ currency: 'IDR' }];
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([mockCurrencies]);

      await getTripSummary(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseJson = res.json.mock.calls[0][0];
      expect(responseJson.tripInfo.recordedTotalAmount).toBe(100000);
      expect(responseJson.expenseSummary.calculatedTotalAmount).toBe(100000);
      expect(responseJson.expenseSummary.averageExpenseAmount).toBe(50000);
    });

    it('should return a trip summary for a USD trip', async () => {
      req.params.tripId = 'trip-456';
      const mockTrip = {
        id: 'trip-456',
        currency: 'USD',
        total_amount: '50050',
      };
      const mockSummary = [
        {
          total_transactions: '1',
          calculated_total: '50050',
          average_expense: '50050',
          min_expense: '50050',
          max_expense: '50050',
        },
      ];
      const mockCurrencies = [{ currency: 'USD' }];
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([mockCurrencies]);

      await getTripSummary(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseJson = res.json.mock.calls[0][0];
      expect(responseJson.tripInfo.recordedTotalAmount).toBe(500.5);
      expect(responseJson.expenseSummary.calculatedTotalAmount).toBe(500.5);
      expect(responseJson.expenseSummary.averageExpenseAmount).toBe(500.5);
    });

    it('should return 404 if trip not found for summary', async () => {
      req.params.tripId = 'non-existent-trip';
      db.execute.mockResolvedValue([[]]);

      await getTripSummary(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Trip not found' });
    });

    it('should return 400 for mixed currencies', async () => {
      req.params.tripId = 'trip-123';
      const mockTrip = { id: 'trip-123', currency: 'IDR' };
      const mockSummary = [{}];
      const mockCurrencies = [{ currency: 'IDR' }, { currency: 'USD' }];
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValueOnce([mockSummary])
        .mockResolvedValueOnce([mockCurrencies]);

      await getTripSummary(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Mixed currencies detected'),
        })
      );
    });
  });
});
