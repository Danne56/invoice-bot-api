# Testing

This directory contains all tests for the Trip Expense Tracker API.

## Structure

- `integration/` - Integration tests that test the API endpoints
- `unit/` - Unit tests for individual functions and modules
- `utils/` - Test utilities and setup files

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/integration/auth.test.js
```

## Test Environment

Tests use a separate configuration defined in `tests/utils/setup.js`:

- `NODE_ENV` is set to 'test'
- Database connections are mocked
- External dependencies like `nanoid` and `node-cron` are mocked
- API key is set to 'test-api-key'

## Coverage

Coverage reports are generated in the `coverage/` directory when running tests with the `--coverage` flag.
