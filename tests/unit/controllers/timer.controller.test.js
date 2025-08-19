const {
  getTimerStatusByTripId,
  cancelTimer,
  listTimers,
  processExpiredTimers,
} = require('../../../src/controllers/timer.controller');
const jobManager = require('../../../src/utils/jobManager');
const cronJobManager = require('../../../src/utils/cronJobs');
const timerHelpers = require('../../../src/utils/timerHelpers');
const logger = require('../../../src/utils/logger');

// Mock dependencies
jest.mock('../../../src/utils/jobManager');
jest.mock('../../../src/utils/cronJobs');
jest.mock('../../../src/utils/timerHelpers');
jest.mock('../../../src/utils/logger');

describe('Timer Controller', () => {
  let req, res;

  beforeEach(() => {
    req = {
      params: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    // Reset mocks and provide default implementations for helpers
    jest.clearAllMocks();
    timerHelpers.formatDuration.mockImplementation(ms => `${ms}ms`);
    timerHelpers.formatRelativeTime.mockImplementation((ms, expired) =>
      expired ? 'expired' : 'active'
    );
    timerHelpers.getTimerStatus.mockImplementation(ms => ({
      status: ms > 0 ? 'active' : 'expired',
    }));
  });

  describe('getTimerStatusByTripId', () => {
    it('should return timer status for an active timer', async () => {
      req.params.tripId = 'trip-123';
      const mockJob = { tripId: 'trip-123', deadline: Date.now() + 60000 };
      jobManager.getJobByTripId.mockResolvedValue(mockJob);

      await getTimerStatusByTripId(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          tripId: 'trip-123',
          isExpired: false,
        })
      );
    });

    it('should return timer status for an expired timer', async () => {
      req.params.tripId = 'trip-456';
      const mockJob = { tripId: 'trip-456', deadline: Date.now() - 1000 };
      jobManager.getJobByTripId.mockResolvedValue(mockJob);

      await getTimerStatusByTripId(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          tripId: 'trip-456',
          isExpired: true,
          timeRemaining: 0,
        })
      );
    });

    it('should return 404 if timer not found', async () => {
      req.params.tripId = 'trip-123';
      jobManager.getJobByTripId.mockResolvedValue(null);

      await getTimerStatusByTripId(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Timer not found' })
      );
    });

    it('should handle errors during status retrieval and return 500', async () => {
      req.params.tripId = 'trip-error';
      const error = new Error('Database failed');
      jobManager.getJobByTripId.mockRejectedValue(error);

      await getTimerStatusByTripId(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Internal server error',
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('cancelTimer', () => {
    it('should cancel an existing timer and return 200', async () => {
      req.params.tripId = 'trip-123';
      jobManager.removeJob.mockResolvedValue(true);

      await cancelTimer(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        tripId: 'trip-123',
        message: 'Timer cancelled successfully',
      });
    });

    it('should return 404 if timer to cancel is not found', async () => {
      req.params.tripId = 'trip-123';
      jobManager.removeJob.mockResolvedValue(false);

      await cancelTimer(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: 'Timer not found' })
      );
    });

    it('should handle errors during cancellation and return 500', async () => {
      req.params.tripId = 'trip-error';
      const error = new Error('Removal failed');
      jobManager.removeJob.mockRejectedValue(error);

      await cancelTimer(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Internal server error',
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('listTimers', () => {
    it('should return a list of timers and stats', async () => {
      const mockJobs = [{ id: 'job-1' }];
      const mockStats = {
        summary: { total: 1, active: 1, expired: 0 },
        jobs: mockJobs,
      };
      jobManager.getAllJobs.mockResolvedValue(mockJobs);
      cronJobManager.getStatus.mockReturnValue({ running: true });
      timerHelpers.calculateTimerStats.mockReturnValue(mockStats);

      await listTimers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: mockStats.summary,
          jobs: mockJobs,
        })
      );
    });

    it('should return an empty list when no timers exist', async () => {
      const mockStats = {
        summary: { total: 0, active: 0, expired: 0 },
        jobs: [],
      };
      jobManager.getAllJobs.mockResolvedValue([]);
      cronJobManager.getStatus.mockReturnValue({ running: true });
      timerHelpers.calculateTimerStats.mockReturnValue(mockStats);

      await listTimers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: mockStats.summary,
          jobs: [],
        })
      );
    });

    it('should handle errors during listing and return 500', async () => {
      const error = new Error('Listing failed');
      jobManager.getAllJobs.mockRejectedValue(error);

      await listTimers(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Internal server error',
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('processExpiredTimers', () => {
    it('should trigger manual processing of expired timers', async () => {
      cronJobManager.triggerManualProcess.mockResolvedValue();

      await processExpiredTimers(req, res);

      expect(cronJobManager.triggerManualProcess).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Manual processing of expired jobs completed',
      });
    });

    it('should handle errors during manual processing and return 500', async () => {
      const error = new Error('Processing failed');
      cronJobManager.triggerManualProcess.mockRejectedValue(error);

      await processExpiredTimers(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Internal server error',
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
