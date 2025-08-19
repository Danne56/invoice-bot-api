const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/utils/db');
const jobManager = require('../../src/utils/jobManager');
const cronJobManager = require('../../src/utils/cronJobs');

// Mock database connection and utilities
jest.mock('../../src/utils/db');
jest.mock('../../src/utils/jobManager');
jest.mock('../../src/utils/cronJobs');

const logger = require('../../src/utils/logger');

describe('Timer API', () => {
  const API_KEY = process.env.API_KEY || 'test-api-key';
  const VALID_TRIP_ID = 'trip12345678'; // 12 characters
  const VALID_WEBHOOK_URL = 'https://example.com/webhook';
  const VALID_PHONE_NUMBER = '6281234567890'; // Valid Indonesian phone number

  let loggerErrorSpy;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Spy on logger.error
    loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    // Mock cronJobManager
    cronJobManager.getStatus.mockReturnValue({
      initialized: true,
      running: true,
    });
    cronJobManager.start.mockImplementation(() => {});
    cronJobManager.triggerManualProcess.mockResolvedValue();
  });

  describe('POST /api/start-timer', () => {
    it('should start a new timer with valid data', async () => {
      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: null,
        deadline: Date.now() + 900000, // 15 minutes from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock database connection and jobManager
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No user found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      jobManager.getJobByTripId.mockResolvedValue(null); // No existing job
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('tripId', VALID_TRIP_ID);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('expiresIn');
      expect(response.body).toHaveProperty('expiresAt');
    });

    it('should start a new timer with phone number', async () => {
      const mockUser = {
        id: 'user1234567890',
        phone_number: VALID_PHONE_NUMBER,
      };

      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: 'user1234567890',
        deadline: Date.now() + 900000, // 15 minutes from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock database connection and jobManager
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[mockUser]]), // User found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      jobManager.getJobByTripId.mockResolvedValue(null); // No existing job
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
          phoneNumber: VALID_PHONE_NUMBER,
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(jobManager.addOrUpdateJob).toHaveBeenCalledWith(
        VALID_TRIP_ID,
        VALID_WEBHOOK_URL,
        'user1234567890', // senderId from user lookup
        15 * 60 * 1000 // default 15 minutes
      );
    });

    it('should start a new timer with custom duration', async () => {
      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: null,
        deadline: Date.now() + 1800000, // 30 minutes from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock database connection and jobManager
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No user found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      jobManager.getJobByTripId.mockResolvedValue(null); // No existing job
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
          duration: '30m',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(jobManager.addOrUpdateJob).toHaveBeenCalledWith(
        VALID_TRIP_ID,
        VALID_WEBHOOK_URL,
        null, // no senderId
        30 * 60 * 1000 // 30 minutes in milliseconds
      );
    });

    it('should restart an existing timer', async () => {
      const existingJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: null,
        deadline: Date.now() + 300000, // 5 minutes from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: null,
        deadline: Date.now() + 900000, // 15 minutes from now (restarted)
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock database connection and jobManager
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No user found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      jobManager.getJobByTripId.mockResolvedValue(existingJob); // Existing job found
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.message).toContain('Timer restarted!');
    });

    it('should return 422 for invalid tripId type', async () => {
      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: null, // Invalid type
          webhookUrl: VALID_WEBHOOK_URL,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for missing tripId', async () => {
      const response = await request(app)
        .post('/api/start-timer')
        .send({
          webhookUrl: VALID_WEBHOOK_URL,
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid webhook URL', async () => {
      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: 'invalid-url',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid phone number', async () => {
      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
          phoneNumber: 'invalid-phone',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 422 for invalid duration format', async () => {
      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
          duration: 'invalid-duration',
        })
        .expect(422);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      // Mock database connection to throw error
      const mockConnection = {
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
          phoneNumber: VALID_PHONE_NUMBER,
        })
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });

    it('should start a timer with very short duration', async () => {
      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: null,
        deadline: Date.now() + 1000, // 1 second from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock database connection and jobManager
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No user found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      jobManager.getJobByTripId.mockResolvedValue(null); // No existing job
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
          duration: '1s',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should start a timer with very long duration', async () => {
      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: null,
        deadline: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock database connection and jobManager
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No user found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      jobManager.getJobByTripId.mockResolvedValue(null); // No existing job
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
          duration: '30d',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should start a timer with localhost webhook URL', async () => {
      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: 'http://localhost:3000/webhook',
        senderId: null,
        deadline: Date.now() + 900000, // 15 minutes from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock database connection and jobManager
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No user found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      jobManager.getJobByTripId.mockResolvedValue(null); // No existing job
      jobManager.addOrUpdateJob.mockResolvedValue(mockJob);

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: 'http://localhost:3000/webhook', // Localhost URL
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should handle jobManager errors gracefully', async () => {
      // Mock database connection
      const mockConnection = {
        execute: jest.fn().mockResolvedValueOnce([[]]), // No user found
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(mockConnection);

      // Mock jobManager to throw error
      jobManager.getJobByTripId.mockResolvedValue(null);
      jobManager.addOrUpdateJob.mockRejectedValue(
        new Error('Job manager error')
      );

      const response = await request(app)
        .post('/api/start-timer')
        .send({
          tripId: VALID_TRIP_ID,
          webhookUrl: VALID_WEBHOOK_URL,
        })
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('GET /api/timer/:tripId', () => {
    it('should return timer status for existing timer', async () => {
      const mockJob = {
        id: 'job1234567890',
        tripId: VALID_TRIP_ID,
        webhookUrl: VALID_WEBHOOK_URL,
        senderId: null,
        deadline: Date.now() + 900000, // 15 minutes from now
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phoneNumber: null,
      };

      jobManager.getJobByTripId.mockResolvedValue(mockJob);

      const response = await request(app)
        .get(`/api/timer/status/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('tripId', VALID_TRIP_ID);
      expect(response.body).toHaveProperty('webhookUrl', VALID_WEBHOOK_URL);
      expect(response.body).toHaveProperty('timeRemaining');
      expect(response.body).toHaveProperty('timerStatus');
      expect(response.body).toHaveProperty('isExpired', false);
    });

    it('should return 404 for non-existent timer', async () => {
      jobManager.getJobByTripId.mockResolvedValue(null); // No job found

      const response = await request(app)
        .get(`/api/timer/status/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Timer not found');
    });

    it('should handle jobManager errors gracefully', async () => {
      jobManager.getJobByTripId.mockRejectedValue(
        new Error('Job manager error')
      );

      const response = await request(app)
        .get(`/api/timer/status/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('DELETE /api/timer/:tripId', () => {
    it('should cancel an existing timer', async () => {
      jobManager.removeJob.mockResolvedValue(true); // Successfully removed

      const response = await request(app)
        .delete(`/api/timer/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('tripId', VALID_TRIP_ID);
      expect(response.body).toHaveProperty(
        'message',
        'Timer cancelled successfully'
      );
    });

    it('should return 404 for non-existent timer', async () => {
      jobManager.removeJob.mockResolvedValue(false); // Not found

      const response = await request(app)
        .delete(`/api/timer/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Timer not found');
    });

    it('should handle jobManager errors gracefully', async () => {
      jobManager.removeJob.mockRejectedValue(new Error('Job manager error'));

      const response = await request(app)
        .delete(`/api/timer/${VALID_TRIP_ID}`)
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('GET /api/timer/list', () => {
    it('should return list of all timers', async () => {
      const mockJobs = [
        {
          id: 'job1234567890',
          tripId: 'trip12345678',
          webhookUrl: VALID_WEBHOOK_URL,
          senderId: null,
          deadline: Date.now() + 900000, // 15 minutes from now
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          phoneNumber: null,
        },
      ];

      jobManager.getAllJobs.mockResolvedValue(mockJobs);

      const response = await request(app)
        .get('/api/timer/list')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('cronJobStatus');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('jobs');
      expect(response.body.summary).toHaveProperty('total', 1);
      expect(response.body.summary).toHaveProperty('active', 1);
      expect(loggerErrorSpy).toHaveBeenCalledTimes(0); // Should not log an error
    });

    it('should handle jobManager errors gracefully', async () => {
      jobManager.getAllJobs.mockRejectedValue(new Error('Job manager error'));

      const response = await request(app)
        .get('/api/timer/list')
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('POST /api/timer/process-expired', () => {
    it('should manually trigger processing of expired timers', async () => {
      const response = await request(app)
        .post('/api/timer/process-expired')
        .set('X-API-Key', API_KEY)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty(
        'message',
        'Manual processing of expired jobs completed'
      );
      expect(cronJobManager.triggerManualProcess).toHaveBeenCalled();
    });

    it('should handle cronJobManager errors gracefully', async () => {
      cronJobManager.triggerManualProcess.mockRejectedValue(
        new Error('Cron job error')
      );

      const response = await request(app)
        .post('/api/timer/process-expired')
        .set('X-API-Key', API_KEY)
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });
});
