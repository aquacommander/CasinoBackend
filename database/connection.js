const mysql = require('mysql2/promise');
const { loadEnv, getPoolConfig } = require('./dbConfig');

// Load .env from backend directory (not current working directory)
loadEnv();

let pool = null;

/**
 * Get MySQL connection pool
 */
function getPool() {
  if (!pool) {
    pool = mysql.createPool(getPoolConfig());

    // Handle pool errors
    pool.on('connection', (connection) => {
      connection.on('error', (err) => {
        console.error('MySQL connection error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
          console.log('Attempting to reconnect...');
        }
      });
    });

    // Test connection and log which database is being used
    pool.getConnection()
      .then(connection => {
        console.log('✅ MySQL connected successfully');
        // Log which database is actually being used
        connection.query('SELECT DATABASE() AS db')
          .then(([rows]) => {
            console.log('✅ Using database:', rows[0]?.db || 'none');
            connection.release();
          })
          .catch(err => {
            console.warn('⚠️  Could not query database name:', err.message);
            connection.release();
          });
      })
      .catch(err => {
        console.error('❌ MySQL connection error:', err);
      });
  }
  return pool;
}

/**
 * Execute a query with retry logic for connection errors
 * IMPORTANT: params must be an array, passed as the second argument (no spreading)
 */
async function query(sql, params = [], retries = 3) {
  // Validate params is an array
  if (!Array.isArray(params)) {
    throw new Error('query params must be an array');
  }

  const pool = getPool();
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    let connection = null;
    try {
      // Get a fresh connection from the pool
      connection = await pool.getConnection();
      
      // IMPORTANT: pass params as the second argument (array), NOT spread
      const [results] = await connection.execute(sql, params);
      
      // Release connection back to pool
      connection.release();
      
      return results;
    } catch (error) {
      // Release connection if we got one
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          // Ignore release errors
        }
      }

      // Check if it's a connection error that we should retry
      const isConnectionError = 
        error.code === 'ECONNRESET' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.fatal === true;

      if (isConnectionError && attempt < retries) {
        console.warn(`MySQL connection error (attempt ${attempt}/${retries}): ${error.code || error.message}. Retrying...`);
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
        continue;
      }

      // If it's not a connection error or we've exhausted retries, throw
      console.error('MySQL query error:', error);
      throw error;
    }
  }
}

/**
 * Get a connection from pool
 */
async function getConnection() {
  return await getPool().getConnection();
}

module.exports = {
  getPool,
  query,
  getConnection
};
