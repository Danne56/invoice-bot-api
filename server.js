require('dotenv').config({ quiet: true });
const app = require('./src/app');
const pool = require('./src/utils/db');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 5000;
let server;

// Test database connection and start server
async function startServer() {
  try {
    // Test database connection
    const connection = await pool.getConnection();
    logger.info('Database connected successfully');
    connection.release();

    // Start HTTP server only after successful DB connection
    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    logger.error('Failed to connect to database:', err.message);
    process.exit(1);
  }

  // Handle server errors
  server.on('error', err => {
    logger.error('Server error:', err);
    process.exit(1);
  });
}

// Graceful shutdown with timeout protection
async function gracefulShutdown(signal) {
  logger.info(`${signal} received: shutting down gracefully`);

  const shutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 30000);

  try {
    if (server) {
      await new Promise(resolve => {
        server.close(resolve);
      });
      logger.info('HTTP server closed');
    }

    await pool.end();
    logger.info('Database pool closed');

    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}
// Process signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', async (reason, promise) => {
  logger.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
  await gracefulShutdown('UNHANDLED_REJECTION').catch(() => process.exit(1));
});

process.on('uncaughtException', err => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Start the server
startServer();
