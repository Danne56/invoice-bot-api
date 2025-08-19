const {
  startTimer,
} = require('../../../src/controllers/start-timer.controller');
const jobManager = require('../../../src/utils/jobManager');
const cronJobManager = require('../../../src/utils/cronJobs');
const pool = require('../../../src/utils/db');
const timerHelpers = require('../../../src/utils/timerHelpers');
const logger = require('../../../src/utils/logger');

// Mock dependencies
jest.mock('../../../src/utils/jobManager');
jest.mock('../../../src/utils/cronJobs');
jest.mock('../../../src/utils/db');
jest.mock('../../../src/utils/timerHelpers');
jest.mock('../../../src/utils/logger');

describe('Start Timer Controller', () => {
  let req, res, db;

  beforeEach(() => {
    req = {
      body: {},
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
    timerHelpers.parseDuration.mockImplementation(d => {
      if (typeof d !== 'string' || !d.match(/^\d+[smhd]$/))
        throw new Error('Invalid format');
      const value = parseInt(d.slice(0, -1));
      const unit = d.slice(-1);
      if (unit === 's') return value * 1000;
      if (unit === 'm') return value * 60 * 1000;
      return value * 1000; // fallback for simplicity
    });
    timerHelpers.formatDuration.mockImplementation(ms => `${ms / 1000}s`);
    jest.clearAllMocks();
  });

  describe('startTimer', () => {
    it('should start a new timer with a specified duration', async () => {
      req.body = {
        tripId: 'trip-123',
        webhookUrl: 'http://test.com',
        duration: '30m',
      };
      const mockJob = {
        tripId: 'trip-123',
        deadline: Date.now() + 30 * 60 * 1000,
      };
      jobManager.getJobByTripId.mockResolvedValue(null);
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);
      cronJobManager.getStatus.mockReturnValue({ running: true });

      await startTimer(req, res);

      expect(timerHelpers.parseDuration).toHaveBeenCalledWith('30m');
      expect(jobManager.addOrUpdateJob).toHaveBeenCalledWith(
        'trip-123',
        'http://test.com',
        null,
        30 * 60 * 1000
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('Timer started'),
        })
      );
    });

    it('should start a new timer with the default 15-minute duration if none is provided', async () => {
      req.body = { tripId: 'trip-default', webhookUrl: 'http://test.com' };
      const mockJob = {
        tripId: 'trip-default',
        deadline: Date.now() + 15 * 60 * 1000,
      };
      jobManager.getJobByTripId.mockResolvedValue(null);
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);
      cronJobManager.getStatus.mockReturnValue({ running: true });

      await startTimer(req, res);

      expect(timerHelpers.parseDuration).not.toHaveBeenCalled();
      expect(jobManager.addOrUpdateJob).toHaveBeenCalledWith(
        'trip-default',
        'http://test.com',
        null,
        15 * 60 * 1000
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should restart an existing timer', async () => {
      req.body = { tripId: 'trip-123', webhookUrl: 'http://test.com' };
      const existingJob = { tripId: 'trip-123', deadline: Date.now() - 1000 };
      const newJob = {
        tripId: 'trip-123',
        deadline: Date.now() + 15 * 60 * 1000,
      };
      jobManager.getJobByTripId.mockResolvedValue(existingJob);
      jobManager.addOrUpdateJob.mockResolvedValue(newJob);
      cronJobManager.getStatus.mockReturnValue({ running: true });

      await startTimer(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('restarted'),
        })
      );
    });

    it('should look up user by phone number and set senderId', async () => {
      req.body = {
        tripId: 'trip-user',
        webhookUrl: 'http://test.com',
        phoneNumber: '6281234567890',
      };
      const mockUser = { id: 'user-123' };
      const mockJob = {
        tripId: 'trip-user',
        deadline: Date.now() + 15 * 60 * 1000,
      };
      db.execute.mockResolvedValue([[mockUser]]);
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);
      cronJobManager.getStatus.mockReturnValue({ running: true });

      await startTimer(req, res);

      expect(db.execute).toHaveBeenCalledWith(expect.any(String), [
        '6281234567890',
      ]);
      expect(jobManager.addOrUpdateJob).toHaveBeenCalledWith(
        'trip-user',
        'http://test.com',
        'user-123',
        expect.any(Number)
      );
    });

    it('should proceed without senderId if user is not found', async () => {
      req.body = {
        tripId: 'trip-nouser',
        webhookUrl: 'http://test.com',
        phoneNumber: '000',
      };
      const mockJob = {
        tripId: 'trip-nouser',
        deadline: Date.now() + 15 * 60 * 1000,
      };
      db.execute.mockResolvedValue([[]]); // No user found
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);
      cronJobManager.getStatus.mockReturnValue({ running: true });

      await startTimer(req, res);

      expect(logger.warn).toHaveBeenCalledWith(
        'User not found for phone number 000'
      );
      expect(jobManager.addOrUpdateJob).toHaveBeenCalledWith(
        'trip-nouser',
        'http://test.com',
        null,
        expect.any(Number)
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should start the cron job if it is not running', async () => {
      req.body = { tripId: 'trip-cron', webhookUrl: 'http://test.com' };
      const mockJob = {
        tripId: 'trip-cron',
        deadline: Date.now() + 15 * 60 * 1000,
      };
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);
      cronJobManager.getStatus.mockReturnValue({ running: false });

      await startTimer(req, res);

      expect(cronJobManager.start).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 for invalid duration format', async () => {
      req.body = {
        tripId: 'trip-invalid',
        webhookUrl: 'http://test.com',
        duration: 'invalid',
      };
      timerHelpers.parseDuration.mockImplementation(() => {
        throw new Error('Invalid format');
      });

      await startTimer(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid duration' })
      );
    });

    it('should handle job manager errors and return 500', async () => {
      req.body = { tripId: 'trip-error', webhookUrl: 'http://test.com' };
      const error = new Error('Job manager failed');
      jobManager.addOrUpdateJob.mockRejectedValue(error);
      cronJobManager.getStatus.mockReturnValue({ running: true });

      await startTimer(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Internal server error' })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
