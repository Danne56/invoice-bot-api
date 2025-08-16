const express = require('express');
const { body, param, validationResult } = require('express-validator');
const UserModel = require('../models/userModel');
const logger = require('../utils/logger');
const { formatAmountForDisplay, toMajor } = require('../utils/currency');

const router = express.Router();

function formatUserStatusResponse(status) {
  const response = {
    is_active: Boolean(status.is_active),
    current_trip: null,
  };

  if (status.trip_id) {
    const currency = status.currency || 'IDR';
    const minor = parseInt(status.total_amount || 0, 10);
    response.current_trip = {
      trip_id: status.trip_id,
      event_name: status.event_name,
      started_at: status.started_at,
      currency,
      amount: toMajor(currency, minor),
      display_amount: formatAmountForDisplay(currency, minor),
      transaction_count: parseInt(status.transaction_count || 0, 10),
    };
  }
  return response;
}

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn({ errors: errors.array(), reqBody: req.body });
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post(
  '/',
  body('phone_number')
    .isMobilePhone('any')
    .notEmpty()
    .withMessage('Invalid phone number'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { phone_number } = req.body;
      const user = await UserModel.ensureUser(phone_number);
      res.status(201).json({
        success: true,
        user: {
          id: user.id,
          phone_number: user.phone_number,
          is_active: Boolean(user.is_active),
          current_trip_id: user.current_trip_id,
          created_at: user.created_at,
          updated_at: user.updated_at,
        },
        message: 'User ensured/created successfully',
      });
    } catch (err) {
      logger.error({ err, reqBody: req.body }, 'Failed to create user');
      next(err);
    }
  }
);

router.get(
  '/:phoneNumber',
  param('phoneNumber')
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { phoneNumber } = req.params;
      const user = await UserModel.findByPhoneNumber(phoneNumber);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (user.total_amount !== null) {
        const currency = user.current_trip_currency || 'IDR';
        const minor = parseInt(user.total_amount, 10);
        user.amount = toMajor(currency, minor);
        user.display_amount = formatAmountForDisplay(currency, minor);
        user.currency = currency;
      }
      res.status(200).json({ data: user });
    } catch (err) {
      logger.error(
        { err, phone_number: req.params.phoneNumber },
        'Failed to fetch user'
      );
      next(err);
    }
  }
);

router.get(
  '/:phoneNumber/status',
  param('phoneNumber')
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { phoneNumber } = req.params;
      const status = await UserModel.getStatusByPhoneNumber(phoneNumber);
      if (!status) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.status(200).json(formatUserStatusResponse(status));
    } catch (err) {
      logger.error(
        { err, phone_number: req.params.phoneNumber },
        'Failed to fetch user status'
      );
      next(err);
    }
  }
);

module.exports = router;
