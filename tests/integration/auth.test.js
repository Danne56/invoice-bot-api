const request = require('supertest');
const app = require('../../src/app');

describe('Authentication', () => {
  const API_KEY = process.env.API_KEY || 'test-api-key';
  const VALID_API_KEY = API_KEY;
  const INVALID_API_KEY = 'invalid-api-key';

  describe('GET /health', () => {
    it('should return 200 OK without authentication', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('API Key Authentication', () => {
    it('should allow access with valid API key', async () => {
      const response = await request(app)
        .get('/api/users/invalid-phone-number') // Using a non-existent endpoint to test auth
        .set('X-API-Key', VALID_API_KEY)
        .expect(422); // 422 because of validation error, not 401

      // Should not be unauthorized
      expect(response.body).not.toHaveProperty('error', 'Unauthorized');
    });

    it('should reject access without API key', async () => {
      const response = await request(app)
        .get('/api/users/invalid-phone-number')
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should reject access with invalid API key', async () => {
      const response = await request(app)
        .get('/api/users/invalid-phone-number')
        .set('X-API-Key', INVALID_API_KEY)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should reject access with empty API key', async () => {
      const response = await request(app)
        .get('/api/users/invalid-phone-number')
        .set('X-API-Key', '')
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });
  });
});
