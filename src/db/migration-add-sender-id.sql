-- Migration script to add sender_id column to webhook_timers table
-- Run this script to update existing database

-- Add sender_id column to webhook_timers table
ALTER TABLE webhook_timers
ADD COLUMN sender_id VARCHAR(12) NULL AFTER webhook_url;

-- Add foreign key constraint
ALTER TABLE webhook_timers
ADD CONSTRAINT fk_webhook_timers_sender
FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX idx_sender_id ON webhook_timers(sender_id);

-- Show updated table structure
DESCRIBE webhook_timers;
