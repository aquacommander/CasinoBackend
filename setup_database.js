/**
 * Database Setup Script
 * This script creates the MySQL database and tables
 * Run: node setup_database.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { loadEnv, getDbName, getConnectionConfig } = require('./database/dbConfig');

loadEnv();

// Database configuration (uses same env vars as the app)
const dbConfig = getConnectionConfig({ includeDatabase: false, multipleStatements: true });

const dbName = getDbName();
const schemaPath = path.join(__dirname, 'database', 'schema.sql');

async function setupDatabase() {
  let connection;

  try {
    console.log('🔌 Connecting to MySQL server...');
    
    // Connect to MySQL server (without database)
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to MySQL server');

    // Read schema file
    console.log('📄 Reading schema file...');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema (includes CREATE DATABASE and CREATE TABLE statements)
    console.log('🏗️  Creating database and tables...');
    console.log(`   Database: ${dbName}`);
    
    await connection.query(schema);
    
    console.log('✅ Database and tables created successfully!');
    
    // Verify by connecting to the database
    console.log('🔍 Verifying database...');
    await connection.changeUser({ database: dbName });
    
    const [databases] = await connection.query('SHOW TABLES');
    console.log(`✅ Database verified! Found ${databases.length} tables.`);
    
    if (databases.length > 0) {
      console.log('\n📊 Tables created:');
      databases.forEach(row => {
        const tableName = Object.values(row)[0];
        console.log(`   - ${tableName}`);
      });
    }

    console.log('\n🎉 Setup complete! You can now start the backend server:');
    console.log('   npm run dev\n');

  } catch (error) {
    console.error('\n❌ Error setting up database:');
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('   Authentication failed. Please check:');
      console.error('   - DB_USER (default: root)');
      console.error('   - DB_PASSWORD');
      console.error('\n   You can set these in a .env file or environment variables.');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('   Cannot connect to MySQL server. Please check:');
      console.error('   - MySQL is installed and running');
      console.error('   - DB_HOST (default: localhost)');
      console.error('   - MySQL is listening on the default port (3306)');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('   Database error. This should not happen in setup.');
    } else {
      console.error(`   ${error.message}`);
      if (error.code) {
        console.error(`   Error code: ${error.code}`);
      }
    }
    
    console.error('\n💡 Tip: Make sure MySQL is installed and running.');
    console.error('   On Windows, check Services (services.msc) for MySQL service.\n');
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run setup
console.log('========================================');
console.log('QUBIC Casino - Database Setup');
console.log('========================================\n');

setupDatabase();
