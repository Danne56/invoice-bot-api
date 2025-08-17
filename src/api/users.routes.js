const express = require('express');
const { body, param } = require('express-validator');
const {
  createUser,
  getUserByPhoneNumber,
  getUserStatus,
} = require('../controllers/users.controller');
const { validate } = require('../middleware/validator');

const router = express.Router();

/**
 * POST /api/users
 * Create a user independently (no trip creation)
 */
router.post(
  '/',
  [
    body('phoneNumber')
      .isMobilePhone('any')
      .notEmpty()
      .withMessage('Invalid phone number'),
  ],
  validate,
  createUser
);

/**
 * GET /api/users/:phoneNumber
 * Get user information including current trip
 */
router.get(
  '/:phoneNumber',
  [
    param('phoneNumber')
      .isMobilePhone('any')
      .withMessage('Invalid phone number'),
  ],
  validate,
  getUserByPhoneNumber
);

/**
 * GET /api/users/:phoneNumber/status
 * Get user's current trip status
 */
router.get(
  '/:phoneNumber/status',
  [
    param('phoneNumber')
      .isMobilePhone('any')
      .withMessage('Invalid phone number'),
  ],
  validate,
  getUserStatus
);

module.exports = router;
