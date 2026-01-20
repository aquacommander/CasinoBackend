// database/connection.js
const mysql = require('mysql2/promise');
const { loadEnv, getPoolConfig } = require('./dbConfig');

// Load .env from backend directory (not current working directory)
loadEnv();

let pool = null;

/**
 * Sanitize pool config so we don't pass invalid mysql2 options.
 * mysql2 supports connectTimeout, but NOT timeout/acquireTimeout on Connection.
 * (acquireTimeout is not a valid mysql2 pool option either.)
 */
function sanitizePoolConfig(raw = {}) {
  const cfg = { ...raw };

  // Remove known-invalid keys that produce warnings
  delete cfg.timeout;
  delete cfg.acquireTimeout;

  // Provide sensible defaults (only if not already set)
  if (cfg.waitForConnections === undefined) cfg.waitForConnections = true;
  if (cfg.connectionLimit === undefined) cfg.connectionLimit = 10;
  if (cfg.queueLimit === undefined) cfg.queueLimit = 0;

  // Use connectTimeout instead of timeout
  if (cfg.connectTimeout === undefined) cfg.connectTimeout = 10000; // 10s

  // Helpful on some hosted envs
  if (cfg.enableKeepAlive === undefined) cfg.enableKeepAlive = true;
  if (cfg.keepAliveInitialDelay === undefined) cfg.keepAliveInitialDelay = 0;

  // Optional: allow big JSON payloads
  // if (cfg.multipleStatements === undefined) cfg.multipleStatements = false;

  // Optional: if you use Railway internal certs/TLS, keep as-is from dbConfig
  return cfg;
}

/**
 * Create pool (singleton)
 */
function getPool() {
  if (pool) return pool;

  const rawConfig = getPoolConfig();
  const config = sanitizePoolConfig(rawConfig);

  pool = mysql.createPool(config);

  // Pool-level error hooks
  pool.on('connection', (connection) => {
    // Connection errors after establishment
    connection.on('error', (err) => {
      console.error('MySQL connection error:', err);
    });
  });

  pool.on('error', (err) => {
    // Pool errors
    console.error('MySQL pool error:', err);
  });

  // Smoke test once at startup and log database
  (async () => {
    try {
      const connection = await pool.getConnection();
      console.log('✅ MySQL connected successfully');

      try {
        const [rows] = await connection.query('SELECT DATABASE() AS db');
        console.log('✅ Using database:', rows?.[0]?.db || 'none');
      } catch (e) {
        console.warn('⚠️  Could not query database name:', e.message);
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('❌ MySQL connection error:', err);
    }
  })();

  return pool;
}

/**
 * Execute a query with retry logic for connection errors
 * IMPORTANT: params must be an array, passed as the second argument (no spreading)
 */
async function query(sql, params = [], retries = 3) {
  if (!Array.isArray(params)) {
    throw new Error('query params must be an array');
  }

  const p = getPool();

  for (let attempt = 1; attempt <= retries; attempt++) {
    let connection;
    try {
      connection = await p.getConnection();

      // Execute with params array (no spreading)
      const [results] = await connection.execute(sql, params);

      connection.release();
      return results;
    } catch (error) {
      if (connection) {
        try { connection.release(); } catch (_) {}
      }

      const isConnectionError =
        error.code === 'ECONNRESET' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'EPIPE' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.fatal === true;

      if (isConnectionError && attempt < retries) {
        console.warn(
          `MySQL connection error (attempt ${attempt}/${retries}): ${
            error.code || error.message
          }. Retrying...`
        );
        // Exponential backoff (1s, 2s, 3s... capped at 5s)
        await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
        continue;
      }

      console.error('MySQL query error:', error);
      throw error;
    }
  }
}

/**
 * Get a raw connection from pool (remember to release it!)
 */
async function getConnection() {
  return await getPool().getConnection();
}

module.exports = {
  getPool,
  query,
  getConnection,
};
