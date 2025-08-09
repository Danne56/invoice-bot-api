# WhatsApp Trip Expense Bot API

A secure Express.js API gateway that acts as an intermediary between **n8n workflows** and **MariaDB database** for a WhatsApp bot designed to track business trip expenses.

## Overview

This API eliminates the need for direct database connections in n8n workflows by providing controlled, validated, and authenticated endpoints. It focuses on **security**, **input validation**, and **simplicity** while managing user trips, expense transactions, and user states.

## Key Features

- 🔐 **API Key Authentication**: All endpoints require valid `X-API-Key` header
- 🛡️ **Input Validation**: Comprehensive data sanitization using `express-validator`
- 🧼 **SQL Injection Protection**: Parameterized queries only with `mysql2`
- ⚖️ **Rate Limiting**: Built-in protection against abuse
- 🔑 **Secure Headers**: Uses `helmet`, `cors`, and `compression`
- 📊 **Connection Pooling**: Efficient MariaDB connection management
- 🧩 **Unique ID Generation**: Uses `nanoid(12)` for all primary keys
- 📈 **Structured Logging**: JSON-based logging with `pino`
- 🏃 **Graceful Shutdown**: Clean database connection closure

## Tech Stack

- **Backend**: Node.js 18+, Express.js 4
- **Database**: MariaDB (via `mysql2`)
- **Security**: `helmet`, `express-rate-limit`, `express-validator`
- **Logging**: `pino` with pretty printing
- **ID Generation**: `nanoid`

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- MariaDB/MySQL database

### Installation

1. **Clone and setup**

   ```bash
   git clone <repository-url>
   cd whatsapp-trip-expense-bot-api
   cp .env.example .env
   ```

2. **Configure environment**

   ```env
   # Update .env with your settings
   DB_HOST=localhost
   DB_USER=trip_expense_user
   DB_PASSWORD=your_secure_password
   DB_NAME=trip_expense_db
   API_KEY=your-super-secret-api-key
   PORT=5000
   ```

3. **Setup database**

   ```bash
   # Create database and user first, then run:
   mysql -h$DB_HOST -u$DB_USER -p$DB_PASSWORD < src/db/database-setup.sql
   ```

4. **Install and run**

   ```bash
   npm install
   npm run dev  # Development mode
   npm start    # Production mode
   ```

The API will be available at `http://localhost:5000`.

## API Endpoints

All endpoints require the `X-API-Key` header for authentication.

### Users

- `POST /api/users/start` - Start a new trip
- `POST /api/users/stop` - Stop the current active trip
- `GET /api/users/:phone_number` - Get user information
- `GET /api/users/:phone_number/status` - Get user's trip status

### Trips

- `GET /api/trips/:trip_id` - Get trip details with transactions
- `GET /api/trips` - Get trips for a user (with filtering)
- `GET /api/trips/:trip_id/summary` - Get trip expense summary

### Transactions

- `POST /api/transactions` - Create a new expense
- `GET /api/transactions/:transaction_id` - Get transaction details
- `PUT /api/transactions/:transaction_id` - Update transaction
- `DELETE /api/transactions/:transaction_id` - Delete transaction
- `GET /api/transactions` - Get transactions (with filtering)

### Health Check

- `GET /health` - Server health status (no auth required)

## Usage Examples

### Start a Trip

```http
POST /api/users/start
Content-Type: application/json
X-API-Key: your-api-key

{
  "phone_number": "+1234567890",
  "event_name": "Business Conference 2024"
}
```

### Record an Expense

```http
POST /api/transactions
Content-Type: application/json
X-API-Key: your-api-key

{
  "trip_id": "abc123def456",
  "amount": 45.50,
  "description": "Hotel breakfast",
  "photo_url": "https://example.com/receipt.jpg"
}
```

### Stop a Trip

```http
POST /api/users/stop
Content-Type: application/json
X-API-Key: your-api-key

{
  "phone_number": "+1234567890"
}
```

## n8n Integration

Use the **HTTP Request** node in n8n workflows:

1. **Method**: `POST`, `GET`, `PUT`, `DELETE`
2. **URL**: `http://your-api-host:5000/api/users/start`
3. **Authentication**: Header Auth
   - **Name**: `X-API-Key`
   - **Value**: Your API key
4. **Body**: JSON data as required

### Example n8n Flow

```bash
WhatsApp Trigger → Parse Command → HTTP Request (API) → WhatsApp Response
```

When user sends `/start Meeting`, n8n:

1. Parses the message to extract event name
2. Calls `POST /api/users/start`
3. Sends confirmation back to WhatsApp

## Database Schema

```sql
-- Users table
CREATE TABLE users (
    id VARCHAR(12) PRIMARY KEY,           -- nanoid(12)
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    is_active TINYINT(1) DEFAULT 0,
    current_trip_id VARCHAR(12) NULL,     -- FK to trips.id
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Trips table
CREATE TABLE trips (
    id VARCHAR(12) PRIMARY KEY,           -- nanoid(12)
    phone_number VARCHAR(20) NOT NULL,    -- FK to users.phone_number
    event_name VARCHAR(255) NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME NULL,
    total_amount DECIMAL(15,2) DEFAULT 0.00,
    status ENUM('active', 'completed') DEFAULT 'active'
);

-- Transactions table
CREATE TABLE transactions (
    id VARCHAR(12) PRIMARY KEY,           -- nanoid(12)
    trip_id VARCHAR(12) NOT NULL,         -- FK to trips.id
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    photo_url TEXT,                       -- Receipt photo URL
    ocr_text TEXT,                        -- Extracted text from receipt
    status ENUM('pending', 'processed', 'failed') DEFAULT 'pending'
);
```

## Project Structure

```bash
/
├── server.js                 # Server entry point
├── package.json             # Dependencies and scripts
├── .env.example             # Environment template
└── src/
    ├── app.js               # Express app configuration
    ├── routes/              # API route definitions
    │   ├── userRoutes.js    # User management (start/stop trips)
    │   ├── tripRoutes.js    # Trip information and summaries
    │   └── transactionRoutes.js # Expense transactions CRUD
    ├── middleware/          # Express middleware
    │   ├── auth.js          # API key authentication
    │   ├── errorHandler.js  # Centralized error handling
    │   └── rateLimiter.js   # Rate limiting protection
    ├── utils/               # Utilities
    │   ├── db.js           # MariaDB connection pool
    │   ├── idGenerator.js  # nanoid(12) ID generation
    │   └── logger.js       # Structured logging (pino)
    └── db/
        └── database-setup.sql # Database schema
```

## Security Best Practices

- 🔒 **Never commit `.env`** to version control
- 🔐 **Run API in private network** (VPC/firewall recommended)
- 🧼 **Always use parameterized queries** - no string concatenation
- 🚫 **No dynamic table/column names** from user input
- 📈 **Rate limiting applied** to prevent abuse
- 🧰 **Server-side error logging** without exposing internals
- 🧩 **Use nanoid(12)** for all primary key IDs
- 🛡️ **Input validation and sanitization** on all endpoints

## Available Scripts

```bash
npm start        # Start production server
npm run dev      # Start development server with nodemon
npm run lint     # Run ESLint
npm run format   # Format code with Prettier
npm run db:setup # Setup database schema
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message"
}
```

Validation errors include details:

```json
{
  "errors": [
    {
      "msg": "Invalid phone number",
      "param": "phone_number",
      "location": "body"
    }
  ]
}
```

## Contributing

1. Follow the existing code patterns
2. Ensure all inputs are validated
3. Use parameterized queries only
4. Test all endpoints with proper error cases
5. Update documentation for new features

## License

MIT License - see LICENSE file for details.
