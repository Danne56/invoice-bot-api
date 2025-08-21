const express = require('express');
const { body, param } = require('express-validator');
const {
  createUser,
  getUserByPhoneNumber,
  getUserStatus,
  markIntroSent,
  resetIntroFlags,
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

/**
 * PUT /api/users/:userId/intro-sent
 * Mark that daily intro has been sent to user
 */
router.put(
  '/:userId/intro-sent',
  [
    param('userId')
      .isString()
      .isLength({ min: 12, max: 12 })
      .withMessage('Invalid user ID'),
  ],
  validate,
  markIntroSent
);

/**
 * POST /api/users/reset-intro
 * Reset intro flags for all users (typically called daily via cron)
 */
router.post('/reset-intro', resetIntroFlags);

module.exports = router;
