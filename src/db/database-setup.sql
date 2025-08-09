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
    INDEX idx_phone_number (phone_number),
    INDEX idx_current_trip (current_trip_id)
);

-- Trips table with custom ID
CREATE TABLE IF NOT EXISTS trips (
    id VARCHAR(12) PRIMARY KEY,  -- Custom ID from nanoid
    phone_number VARCHAR(20) NOT NULL,
    event_name VARCHAR(255) NOT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME NULL,
    total_amount DECIMAL(15,2) DEFAULT 0.00,
    status ENUM('active', 'completed') DEFAULT 'active',
    FOREIGN KEY (phone_number) REFERENCES users(phone_number) ON DELETE CASCADE,
    INDEX idx_phone_active (phone_number, status),
    INDEX idx_status (status)
);

-- Transactions table with custom ID
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(12) PRIMARY KEY,  -- Custom ID from nanoid
    trip_id VARCHAR(12) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    photo_url TEXT,
    ocr_text TEXT,
    status ENUM('pending', 'processed', 'failed') DEFAULT 'pending',
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
    INDEX idx_trip_id (trip_id),
    INDEX idx_recorded_at (recorded_at),
    INDEX idx_status (status)
);

-- Add foreign key constraint for current_trip_id in users table
ALTER TABLE users
ADD FOREIGN KEY (current_trip_id) REFERENCES trips(id) ON DELETE SET NULL;

-- Show created tables
SHOW TABLES;
