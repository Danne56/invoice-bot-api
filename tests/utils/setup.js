// Test setup file
// This file runs before each test file

// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-api-key';
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'test_user';
process.env.DB_PASSWORD = 'test_password';
process.env.DB_NAME = 'test_db';
process.env.PORT = '5001';

// Mock the database connection for unit tests
jest.mock('../../src/utils/db', () => {
  return {
    getConnection: jest.fn(),
    execute: jest.fn(),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    end: jest.fn(),
  };
});

// Mock nanoid to avoid ES module issues
jest.mock('nanoid', () => {
  return {
    customAlphabet: jest.fn(() => jest.fn(() => 'mocked-id-123456789012')),
  };
});

// Mock node-cron to prevent open handles
jest.mock('node-cron', () => {
  return {
    schedule: jest.fn(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      running: false,
    })),
  };
});

// Mock the logger to avoid console output during tests
jest.mock('../../src/utils/logger', () => {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
});
