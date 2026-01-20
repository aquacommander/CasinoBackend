/**
 * Migration script to add tx_id column to mine_games table
 * Run: node migrate_add_tx_id.js
 */

const mysql = require('mysql2/promise');
const { loadEnv, getConnectionConfig, getDbName } = require('./database/dbConfig');

loadEnv();

async function migrate() {
  let connection = null;
  try {
    console.log('🔄 Starting migration: Add tx_id column to mine_games...');
    
    // Connect to MySQL
    connection = await mysql.createConnection(
      getConnectionConfig({ includeDatabase: true, multipleStatements: true })
    );

    console.log('✅ Connected to MySQL');

    // Check if tx_id column already exists
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'mine_games' 
        AND COLUMN_NAME = 'tx_id'
    `, [getDbName()]);

    if (columns.length > 0) {
      console.log('ℹ️  Column tx_id already exists. Skipping...');
      await connection.end();
      return;
    }

    // Add tx_id column
    await connection.query(`
      ALTER TABLE mine_games
        ADD COLUMN tx_id VARCHAR(128) NULL
    `);
    console.log('✅ Added tx_id column');

    // Add index
    await connection.query(`
      CREATE INDEX idx_tx_id ON mine_games(tx_id)
    `);
    console.log('✅ Added index idx_tx_id');

    // Verify
    const [verify] = await connection.query('SHOW COLUMNS FROM mine_games');
    console.log('\n📋 Current mine_games columns:');
    verify.forEach(col => {
      console.log(`  - ${col.Field} (${col.Type})`);
    });

    console.log('\n✅ Migration completed successfully!');
    await connection.end();
  } catch (error) {
    if (connection) {
      await connection.end();
    }
    
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️  Column tx_id already exists. Migration skipped.');
    } else if (error.code === 'ER_DUP_KEYNAME') {
      console.log('ℹ️  Index idx_tx_id already exists. Migration skipped.');
    } else {
      console.error('❌ Migration failed:', error.message);
      console.error('Error details:', error);
      process.exit(1);
    }
  }
}

migrate();
