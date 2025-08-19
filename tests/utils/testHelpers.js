const { generateId } = require('../../src/utils/idGenerator');

// Generate a mock user object
const createMockUser = (overrides = {}) => {
  return {
    id: generateId(12),
    phoneNumber: '+1234567890',
    isActive: false,
    currentTripId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
};

// Generate a mock trip object
const createMockTrip = (overrides = {}) => {
  return {
    id: generateId(12),
    phoneNumber: '+1234567890',
    eventName: 'Business Trip to Jakarta',
    currency: 'IDR',
    startedAt: new Date().toISOString(),
    endedAt: null,
    totalAmount: 0,
    status: 'active',
    ...overrides,
  };
};

// Generate a mock transaction object
const createMockTransaction = (overrides = {}) => {
  return {
    id: generateId(12),
    tripId: generateId(12),
    currency: 'IDR',
    merchant: 'Restaurant',
    date: new Date().toISOString().split('T')[0],
    totalAmount: 100000,
    subtotal: 80000,
    taxAmount: 20000,
    itemCount: 3,
    itemSummary: 'Food and drinks',
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
};

// Generate a mock timer object
const createMockTimer = (overrides = {}) => {
  return {
    id: generateId(12),
    tripId: generateId(12),
    webhookUrl: 'https://example.com/webhook',
    senderId: generateId(12),
    deadline: Date.now() + 900000, // 15 minutes from now
    status: 'active',
    retryCount: 0,
    maxRetries: 3,
    lastRetryAt: null,
    nextRetryAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
};

module.exports = {
  createMockUser,
  createMockTrip,
  createMockTransaction,
  createMockTimer,
};
