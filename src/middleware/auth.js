const logger = require('../utils/logger');

const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    logger.warn({
      message: 'Unauthorized API access attempt',
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.originalUrl,
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  logger.debug({
    message: 'API key authenticated successfully',
    ip: req.ip,
    path: req.path,
  });

  next();
};

module.exports = { authenticateApiKey };
