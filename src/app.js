require('dotenv').config({ quiet: true });
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const { authenticateApiKey } = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// Import Routes
const userRoutes = require('./routes/userRoutes');
const tripRoutes = require('./routes/tripRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const startTimerRoutes = require('./routes/startTimerRoutes');
const apiTimerRoutes = require('./routes/apiTimerRoutes');

// Initialize timer system
const cronJobManager = require('./utils/cronJobs');

const app = express();

// Security & Performance
app.use(helmet());
app.use(compression());
app.use(cors()); // Allow CORS for API access
app.use(express.json({ limit: '10mb' })); // Allow larger payloads for OCR text and images

// Rate Limiting
if (process.env.NODE_ENV !== 'development') {
  app.use(rateLimiter);
}

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'WhatsApp Trip Expense Bot API is running',
    timestamp: new Date().toISOString(),
  });
});

// Timer webhook endpoint (no auth required for external system integration)
// Only allow POST to start-timer, other timer endpoints require auth
app.use('/start-timer', startTimerRoutes);

// API Routes (all protected by API key)
app.use('/api/users', authenticateApiKey, userRoutes);
app.use('/api/trips', authenticateApiKey, tripRoutes);
app.use('/api/transactions', authenticateApiKey, transactionRoutes);
app.use('/api/timer', authenticateApiKey, apiTimerRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error Handling
app.use(errorHandler);

// Initialize timer webhook cron job
cronJobManager.initialize();
cronJobManager.start();

module.exports = app;
