const express = require('express');
const userRoutes = require('../api/users.routes');
const tripRoutes = require('../api/trips.routes');
const transactionRoutes = require('../api/transactions.routes');
const startTimerRoutes = require('../api/start-timer.routes');
const apiTimerRoutes = require('../api/timer.routes');
const { authenticateApiKey } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.use('/start-timer', startTimerRoutes);

// Authenticated routes
router.use('/users', authenticateApiKey, userRoutes);
router.use('/trips', authenticateApiKey, tripRoutes);
router.use('/transactions', authenticateApiKey, transactionRoutes);
router.use('/timer', authenticateApiKey, apiTimerRoutes);

module.exports = router;
