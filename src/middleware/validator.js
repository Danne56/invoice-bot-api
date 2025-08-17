const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  const extractedErrors = [];
  errors.array().map(err => extractedErrors.push({ [err.param]: err.msg }));

  logger.warn(
    { errors: extractedErrors, reqBody: req.body },
    `Validation failed for ${req.originalUrl}`
  );

  return res.status(422).json({
    errors: extractedErrors,
  });
};

module.exports = {
  validate,
};
