# Quick Start Guide

## Step 1: Install Dependencies

```bash
cd backend
npm install
```

## Step 2: Create Database (REQUIRED!)

Run the database setup script:

```bash
npm run setup-db
```

Or directly:
```bash
node setup_database.js
```

This will:
- Connect to your MySQL server
- Create the `qubic_casino` database
- Create all necessary tables

**Note:** Make sure MySQL is running before running this script!

## Step 3: Start the Backend

```bash
npm run dev
```

The server will start on `http://localhost:3001`

## Troubleshooting

### "ER_ACCESS_DENIED_ERROR"
- Wrong MySQL username/password
- Create a `.env` file in the `backend` directory:
  ```env
  DB_USER=root
  DB_PASSWORD=your_password
  ```

### "ECONNREFUSED"
- MySQL server is not running
- Start MySQL service:
  - Windows: Open Services (`services.msc`), find MySQL, click Start
  - Or start MySQL from your installation (XAMPP, WAMP, etc.)

### "Unknown database 'qubic_casino'"
- You skipped Step 2! Run `npm run setup-db` first.

## Environment Variables (Optional)

Create a `.env` file in the `backend` directory:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=qubic_casino
PORT=3001
NODE_ENV=development
```

If you don't create a `.env` file, defaults will be used (root user, no password, localhost).
