const {
  createTransaction,
  getTransactionById,
  getTransactions,
} = require('../../../src/controllers/transactions.controller');
const pool = require('../../../src/utils/db');
const idGenerator = require('../../../src/utils/idGenerator');
const logger = require('../../../src/utils/logger');

// Mock dependencies
jest.mock('../../../src/utils/db');
jest.mock('../../../src/utils/idGenerator');
jest.mock('../../../src/utils/logger');

describe('Transactions Controller', () => {
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
    };
    pool.getConnection.mockResolvedValue(db);
    jest.clearAllMocks();
  });

  describe('createTransaction', () => {
    it('should create a new IDR transaction and return 201', async () => {
      req.body = {
        tripId: 'trip-123',
        totalAmount: 100000,
        currency: 'IDR',
        merchant: 'Test Merchant',
      };
      const mockTxId = 'mock-tx-id';
      const mockTrip = { id: 'trip-123', status: 'active', currency: 'IDR' };

      idGenerator.generateId.mockReturnValue(mockTxId);
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValue([[{ affectedRows: 1 }]]);

      await createTransaction(req, res);

      expect(idGenerator.generateId).toHaveBeenCalledWith(12);
      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        transactionId: mockTxId,
        tripId: 'trip-123',
        currency: 'IDR',
        amount: 100000,
        displayAmount: 'Rp100.000',
        merchant: 'Test Merchant',
        message: 'Invoice of Rp100.000 recorded successfully',
      });
    });

    it('should create a new USD transaction with subtotal and tax', async () => {
      req.body = {
        tripId: 'trip-456',
        totalAmount: 120.5,
        subtotal: 100,
        taxAmount: 20.5,
        currency: 'USD',
        merchant: 'US Store',
      };
      const mockTxId = 'mock-tx-id-2';
      const mockTrip = { id: 'trip-456', status: 'active', currency: 'USD' };

      idGenerator.generateId.mockReturnValue(mockTxId);
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValue([[{ affectedRows: 1 }]]);

      await createTransaction(req, res);

      expect(db.execute).toHaveBeenCalledWith(expect.any(String), [
        mockTxId,
        'trip-456',
        'USD',
        'US Store',
        null,
        12050,
        10000,
        2050,
        null,
        null,
      ]);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 120.5, displayAmount: '$ 120.50' })
      );
    });

    it('should set trip currency if it was not set before', async () => {
      req.body = { tripId: 'trip-789', totalAmount: 50, currency: 'USD' };
      const mockTxId = 'mock-tx-id-3';
      const mockTrip = { id: 'trip-789', status: 'active', currency: null }; // Legacy trip

      idGenerator.generateId.mockReturnValue(mockTxId);
      db.execute
        .mockResolvedValueOnce([[mockTrip]])
        .mockResolvedValue([[{ affectedRows: 1 }]]);

      await createTransaction(req, res);

      // Called 3 times: get trip, insert transaction, UPDATE trip currency
      expect(db.execute).toHaveBeenCalledTimes(3);
      expect(db.execute).toHaveBeenCalledWith(
        'UPDATE trips SET currency = ? WHERE id = ?',
        ['USD', 'trip-789']
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should return 404 if trip not found', async () => {
      req.body = { tripId: 'trip-123', totalAmount: 100 };
      db.execute.mockResolvedValue([[]]);

      await createTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Trip not found' });
    });

    it('should return 400 for a completed trip', async () => {
      req.body = { tripId: 'trip-123', totalAmount: 100 };
      const mockTrip = { status: 'completed' };
      db.execute.mockResolvedValue([[mockTrip]]);

      await createTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot add transactions to a completed trip',
      });
    });

    it('should return 400 for currency mismatch', async () => {
      req.body = { tripId: 'trip-123', totalAmount: 100, currency: 'USD' };
      const mockTrip = { status: 'active', currency: 'IDR' };
      db.execute.mockResolvedValue([[mockTrip]]);

      await createTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Trip currency (IDR) does not match transaction currency (USD)',
      });
    });

    it('should handle database errors and return 500', async () => {
      req.body = { tripId: 'trip-123', totalAmount: 100 };
      const error = new Error('Database error');
      db.execute.mockRejectedValue(error);

      await createTransaction(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to record transaction',
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getTransactionById', () => {
    it('should return a transaction by ID with IDR currency', async () => {
      req.params.transactionId = 'tx-123';
      const mockTx = {
        id: 'tx-123',
        total_amount: '100000',
        subtotal: '90000',
        tax_amount: '10000',
        currency: 'IDR',
      };
      db.execute.mockResolvedValue([[mockTx]]);

      await getTransactionById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'tx-123',
          amount: 100000,
          displayAmount: 'Rp100.000',
          subtotalAmount: 90000,
          subtotalDisplay: 'Rp90.000',
          taxAmount: 10000,
          taxDisplay: 'Rp10.000',
        }),
      });
    });

    it('should return a transaction by ID with USD currency', async () => {
      req.params.transactionId = 'tx-456';
      const mockTx = {
        id: 'tx-456',
        total_amount: '12050',
        subtotal: '10000',
        tax_amount: '2050',
        currency: 'USD',
      };
      db.execute.mockResolvedValue([[mockTx]]);

      await getTransactionById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'tx-456',
          amount: 120.5,
          displayAmount: '$ 120.50',
          subtotalAmount: 100.0,
          subtotalDisplay: '$ 100.00',
          taxAmount: 20.5,
          taxDisplay: '$ 20.50',
        }),
      });
    });

    it('should return 404 if transaction not found', async () => {
      req.params.transactionId = 'tx-123';
      db.execute.mockResolvedValue([[]]);

      await getTransactionById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Transaction not found' });
    });
  });

  describe('getTransactions', () => {
    it('should return a list of transactions with mixed currencies', async () => {
      req.query = { limit: 10, offset: 0 };
      const mockTxs = [
        { id: 'tx-1', total_amount: '50000', currency: 'IDR' },
        { id: 'tx-2', total_amount: '7500', currency: 'USD' },
      ];
      db.execute.mockResolvedValue([mockTxs]);

      await getTransactions(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const responseData = res.json.mock.calls[0][0].data;
      expect(responseData.length).toBe(2);
      expect(responseData[0].displayAmount).toBe('Rp50.000');
      expect(responseData[1].displayAmount).toBe('$ 75.00');
    });

    it('should return an empty list if no transactions found', async () => {
      req.query = { tripId: 'non-existent-trip' };
      db.execute.mockResolvedValue([[]]);

      await getTransactions(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [],
        pagination: { limit: 20, offset: 0 },
      });
    });

    it('should build query with all filters', async () => {
      req.query = {
        tripId: 'trip-123',
        merchant: 'Test',
        dateFrom: '2023-01-01',
        dateTo: '2023-01-31',
        limit: 5,
        offset: 5,
      };
      db.execute.mockResolvedValue([[]]);

      await getTransactions(req, res);

      const expectedQuery = expect.stringMatching(
        /WHERE\s+1=1\s+AND\s+t\.trip_id\s+=\s+\?\s+AND\s+t\.merchant\s+LIKE\s+\?\s+AND\s+t\.date\s+>=\s+\?\s+AND\s+t\.date\s+<=\s+\?/
      );
      const expectedParams = [
        'trip-123',
        '%Test%',
        '2023-01-01',
        '2023-01-31',
        5,
        5,
      ];
      expect(db.execute).toHaveBeenCalledWith(expectedQuery, expectedParams);
    });
  });
});
