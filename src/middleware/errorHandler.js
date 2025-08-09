const logger = require('../utils/logger');

const errorHandler = (err, res) => {
  logger.error('API Error:', err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
};

module.exports = errorHandler;
