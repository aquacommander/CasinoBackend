const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv() {
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
  return process.env.DB_NAME || 'qubic_casino';
}

function getSslConfig() {
  const sslEnabled = parseBoolean(process.env.DB_SSL || process.env.MYSQL_SSL);
  if (!sslEnabled) return null;

  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED;
  if (rejectUnauthorized === undefined) {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: parseBoolean(rejectUnauthorized) };
}

function getConnectionConfig({ includeDatabase = true, multipleStatements = false } = {}) {
  const uri = process.env.DATABASE_URL || process.env.MYSQL_URL;
  const portValue = process.env.DB_PORT || process.env.MYSQL_PORT;
  const port = portValue ? parseInt(portValue, 10) : undefined;
  const ssl = getSslConfig();

  if (uri) {
    return {
      uri,
      ...(multipleStatements ? { multipleStatements: true } : {}),
      ...(ssl ? { ssl } : {})
    };
  }

  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
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

function getPoolConfig() {
  const connectionLimit = parseInt(
    process.env.DB_POOL_LIMIT || process.env.DB_CONNECTION_LIMIT || '10',
    10
  );
  const acquireTimeout = parseInt(process.env.DB_ACQUIRE_TIMEOUT || '60000', 10);
  const timeout = parseInt(process.env.DB_TIMEOUT || '60000', 10);

  return {
    ...getConnectionConfig({ includeDatabase: true }),
    waitForConnections: true,
    connectionLimit: Number.isFinite(connectionLimit) ? connectionLimit : 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    acquireTimeout,
    timeout
  };
}

module.exports = {
  loadEnv,
  getDbName,
  getConnectionConfig,
  getPoolConfig
};
