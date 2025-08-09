# Trip Expense Tracker API

A secure Express.js API gateway that acts as an intermediary between n8n workflows and a MariaDB database for a WhatsApp bot designed to track business trip expenses.

## Overview

This API abstracts database operations away from n8n workflows by providing a set of controlled, validated, and authenticated endpoints. Its core design principles are security, robust input validation, and a simplified interface for managing user trips, expense transactions, and state.

## Core Features

- **API Key Authentication**: All endpoints are protected and require a valid `X-API-Key` header.
- **Input Validation**: Comprehensive data sanitization and validation using `express-validator`.
- **SQL Injection Protection**: Exclusively uses parameterized queries via the `mysql2` library to prevent SQL injection vulnerabilities.
- **Rate Limiting**: Includes middleware to protect against brute-force and denial-of-service attacks.
- **Secure HTTP Headers**: Implements `helmet`, `cors`, and `compression` for enhanced security.
- **Database Connection Pooling**: Efficiently manages MariaDB connections for optimal performance.
- **Unique ID Generation**: Employs `nanoid(12)` for non-sequential, unique primary keys.
- **Structured Logging**: Utilizes `pino` for structured, JSON-based logging suitable for production environments.
- **Graceful Shutdown**: Ensures database connections are closed cleanly on process termination.

## Technology Stack

- **Backend**: Node.js 18+, Express.js 5.x
- **Database**: MariaDB (via `mysql2`)
- **Security**: `helmet`, `express-rate-limit`, `express-validator`
- **Logging**: `pino` and `pino-pretty` (for development)
- **ID Generation**: `nanoid`

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- MariaDB or a compatible MySQL server

### Installation

1. **Clone and configure the repository:**

    ```bash
    git clone <repository-url>
    cd whatsapp-trip-expense-bot-api
    cp .env.example .env
    ```

2. **Set up environment variables:**
    Update the `.env` file with your database credentials and application settings.

    ```env
    # .env
    DB_HOST=localhost
    DB_USER=trip_expense_user
    DB_PASSWORD=your_secure_password
    DB_NAME=trip_expense_db
    API_KEY=your-super-secret-api-key
    PORT=5000
    ```

3. **Initialize the database:**
    Ensure the database and user are created, then execute the setup script.

    ```bash
    npm run db:setup
    ```

4. **Install dependencies and run the server:**

    ```bash
    npm install
    npm run dev  # For development with live reloading
    npm start    # For production
    ```

The API will be accessible at `http://localhost:5000`.

## API Endpoints

All endpoints require an `X-API-Key` header for authentication.

### Users

- `POST /api/users/start`: Initiates a new trip for a user.
- `POST /api/users/stop`: Concludes the current active trip for a user.
- `GET /api/users/:phone_number`: Retrieves user information.
- `GET /api/users/:phone_number/status`: Fetches a user's current trip status.

### Trips

- `GET /api/trips`: Fetches trips for a user. Requires a `phone_number` query parameter. Supports `status`, `limit`, and `offset` for filtering and pagination.
- `GET /api/trips/:trip_id`: Retrieves trip details, including all associated transactions.
- `GET /api/trips/:trip_id/summary`: Provides a summary of expenses for a specific trip.

### Transactions

- `POST /api/transactions`: Creates a new expense transaction.
- `GET /api/transactions/:transaction_id`: Retrieves details for a single transaction.
- `PUT /api/transactions/:transaction_id`: Updates an existing transaction.
- `DELETE /api/transactions/:transaction_id`: Deletes a transaction.
- `GET /api/transactions`: Fetches transactions. Supports filtering by `trip_id` and `status`, and pagination with `limit` and `offset`.

### Health Check

- `GET /health`: Returns the server's health status (no authentication required).

## Available Scripts

- `npm start`: Starts the production server.
- `npm run dev`: Starts the development server using `nodemon`.
- `npm run lint`: Lints the codebase using ESLint.
- `npm run format`: Formats code using Prettier.
- `npm run db:setup`: Executes the database setup script from `src/db/database-setup.sql`.

## Error Responses

Errors are returned in a consistent JSON format.

**General Error:**

```json
{
  "error": "A human-readable error message."
}
```

**Validation Error:**

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
