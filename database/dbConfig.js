// database/dbConfig.js
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv() {
  // Load .env from backend directory (../.env from /database)
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function parseBoolean(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'required'].includes(normalized);
}

function getDbName() {
  return process.env.DB_NAME || process.env.MYSQLDATABASE || 'qubic_casino';
}

function getSslConfig() {
  // Allow several env names
  const sslEnabled = parseBoolean(
    process.env.DB_SSL ??
    process.env.MYSQL_SSL ??
    process.env.DB_USE_SSL
  );

  if (!sslEnabled) return null;

  // Default to NOT rejecting self-signed certs in hosted environments
  const rejectUnauthorizedEnv =
    process.env.DB_SSL_REJECT_UNAUTHORIZED ??
    process.env.MYSQL_SSL_REJECT_UNAUTHORIZED;

  if (rejectUnauthorizedEnv === undefined) {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: parseBoolean(rejectUnauthorizedEnv) };
}

/**
 * Build connection config for mysql2.
 * Supports:
 * - Railway: MYSQL_URL (recommended)
 * - Generic: DATABASE_URL
 * - Manual: DB_HOST/DB_USER/DB_PASSWORD/DB_PORT
 */
function getConnectionConfig({ includeDatabase = true, multipleStatements = false } = {}) {
  const ssl = getSslConfig();

  // Prefer URL-style configs if present (Railway provides MYSQL_URL)
  // mysql2 uses "uri" as shorthand in some wrappers, but the actual mysql2 option is "uri" ONLY if you pass it to createConnection.
  // For createPool, safest is to pass it as "uri" OR parse it into host/user/etc.
  // mysql2 DOES accept a URL string directly if passed as the first argument, but we're using objects.
  // So we keep "uri" for compatibility with existing project code (connection.js sanitizes pool config).
  const uri = process.env.MYSQL_URL || process.env.DATABASE_URL;

  if (uri) {
    return {
      uri,
      ...(multipleStatements ? { multipleStatements: true } : {}),
      ...(ssl ? { ssl } : {})
    };
  }

  const portValue = process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT;
  const port = portValue ? parseInt(portValue, 10) : undefined;

  const config = {
    host: process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
    user: process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || ''
  };

  if (includeDatabase) {
    config.database = getDbName();
  }

  if (Number.isFinite(port)) {
    config.port = port;
  }

  if (multipleStatements) {
    config.multipleStatements = true;
  }

  if (ssl) {
    config.ssl = ssl;
  }

  return config;
}

/**
 * Pool config for mysql2.createPool().
 * IMPORTANT:
 * - mysql2 DOES NOT support "timeout" or "acquireTimeout" here (those caused your warnings)
 * - Use connectTimeout (valid)
 */
function getPoolConfig() {
  const connectionLimit = parseInt(
    process.env.DB_POOL_LIMIT || process.env.DB_CONNECTION_LIMIT || '10',
    10
  );

  const connectTimeout = parseInt(
    process.env.DB_CONNECT_TIMEOUT || process.env.MYSQL_CONNECT_TIMEOUT || '10000',
    10
  );

  return {
    ...getConnectionConfig({ includeDatabase: true }),

    // Pool behavior
    waitForConnections: true,
    connectionLimit: Number.isFinite(connectionLimit) ? connectionLimit : 10,
    queueLimit: 0,

    // Valid mysql2 options
    connectTimeout: Number.isFinite(connectTimeout) ? connectTimeout : 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };
}

module.exports = {
  loadEnv,
  getDbName,
  getSslConfig,
  getConnectionConfig,
  getPoolConfig
};
