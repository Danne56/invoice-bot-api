module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/db/database-setup.sql',
    '!src/utils/logger.js', // Exclude logger as it's hard to test
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/utils/setup.js'],
  testTimeout: 10000,
  detectOpenHandles: true,
  forceExit: true,
};
