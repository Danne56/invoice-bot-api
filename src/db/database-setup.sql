-- Database schema for WhatsApp Trip Expense Bot API
-- Using nanoid(12) for primary keys

-- Users table with custom ID
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(12) PRIMARY KEY,  -- Custom ID from nanoid
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    current_trip_id VARCHAR(12) NULL,  -- If trip also uses custom ID
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (current_trip_id) REFERENCES trips(id) ON DELETE SET NULL,
    INDEX idx_phone_number (phone_number),
    INDEX idx_current_trip (current_trip_id)
);

-- Trips table with custom ID
CREATE TABLE IF NOT EXISTS trips (
    id VARCHAR(12) PRIMARY KEY,  -- Custom ID from nanoid
    phone_number VARCHAR(20) NOT NULL,
    event_name VARCHAR(255) NOT NULL,
    currency ENUM('IDR','USD') NOT NULL DEFAULT 'IDR',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME NULL,
    total_amount DECIMAL(15,0) DEFAULT 0,  -- Indonesian Rupiah (no decimal places)
    status ENUM('active', 'completed') DEFAULT 'active',
    FOREIGN KEY (phone_number) REFERENCES users(phone_number) ON DELETE CASCADE,
    INDEX idx_phone_active (phone_number, status),
    INDEX idx_status (status),
    INDEX idx_trip_currency (currency)
);

-- Transactions table with custom ID
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(12) PRIMARY KEY,  -- Custom ID from nanoid
    trip_id VARCHAR(12) NOT NULL,
    currency ENUM('IDR','USD') NOT NULL DEFAULT 'IDR',
    merchant VARCHAR(100),
    date DATE,
    total_amount DECIMAL(15, 0),
    subtotal DECIMAL(15, 0),
    tax_amount DECIMAL(15, 0),
    item_count INT,
    item_summary TEXT,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
    INDEX idx_date (date),
    INDEX idx_merchant (merchant),
    INDEX idx_total_amount (total_amount),
    INDEX idx_tx_currency (currency)
);

-- Webhook timers table for timer-based webhook system
CREATE TABLE IF NOT EXISTS webhook_timers (
    id VARCHAR(12) PRIMARY KEY,  -- Custom ID from nanoid
    trip_id VARCHAR(12) NOT NULL,
    webhook_url TEXT NOT NULL,
    sender_id VARCHAR(12) NULL,  -- References users(id), who created the timer
    deadline_timestamp BIGINT NOT NULL,  -- Unix timestamp in milliseconds
    status ENUM('active', 'expired', 'completed') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_trip_id (trip_id),
    INDEX idx_deadline (deadline_timestamp),
    INDEX idx_status (status),
    INDEX idx_status_deadline (status, deadline_timestamp),
    INDEX idx_sender_id (sender_id)
);

-- Show created tables
SHOW TABLES;
