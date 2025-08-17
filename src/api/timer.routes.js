const express = require('express');
const {
  getTimerStatusByTripId,
  cancelTimer,
  listTimers,
  processExpiredTimers,
} = require('../../controllers/timer.controller');

const router = express.Router();

/**
 * GET /api/timer/status/:tripId
 * Get timer status for a specific tripId
 */
router.get('/status/:tripId', getTimerStatusByTripId);

/**
 * DELETE /api/timer/:tripId
 * Cancel a timer for a specific tripId
 */
router.delete('/:tripId', cancelTimer);

/**
 * GET /api/timer/list
 * Get all active timers with enhanced statistics
 */
router.get('/list', listTimers);

/**
 * POST /api/timer/process-expired
 * Manually trigger processing of expired jobs
 */
router.post('/process-expired', processExpiredTimers);

module.exports = router;
