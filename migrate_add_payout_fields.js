// Migration script to add payout fields to mine_games table
const { loadEnv } = require('./database/dbConfig');
const { getPool } = require('./database/connection');

loadEnv();

async function migrate() {
  const pool = getPool();
  
  try {
    console.log('Starting migration: Add payout fields to mine_games table...');
    
    // Check if columns already exist
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'mine_games'
        AND COLUMN_NAME LIKE 'payout%'
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    console.log('Existing payout columns:', existingColumns);
    
    // Add columns if they don't exist
    const columnsToAdd = [
      { name: 'payout_amount', type: 'BIGINT NULL DEFAULT NULL' },
      { name: 'payout_tx_id', type: 'VARCHAR(128) NULL DEFAULT NULL' },
      { name: 'payout_status', type: "VARCHAR(20) NOT NULL DEFAULT 'NONE'" },
      { name: 'multiplier', type: 'DECIMAL(10, 4) NULL DEFAULT NULL' },
      { name: 'revealed_gems', type: 'INT NULL DEFAULT NULL' },
      { name: 'house_edge', type: 'DECIMAL(5, 4) NULL DEFAULT NULL' },
      { name: 'payout_error', type: 'TEXT NULL DEFAULT NULL' },
    ];
    
    for (const col of columnsToAdd) {
      if (!existingColumns.includes(col.name)) {
        console.log(`Adding column: ${col.name}...`);
        await pool.query(`ALTER TABLE mine_games ADD COLUMN ${col.name} ${col.type}`);
        console.log(`✓ Added ${col.name}`);
      } else {
        console.log(`- ${col.name} already exists, skipping`);
      }
    }
    
    // Add indexes if they don't exist
    const indexes = [
      { name: 'idx_payout_status', column: 'payout_status' },
      { name: 'idx_payout_tx_id', column: 'payout_tx_id' },
    ];
    
    for (const idx of indexes) {
      try {
        const [existing] = await pool.query(`
          SELECT COUNT(*) as count
          FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'mine_games'
            AND INDEX_NAME = ?
        `, [idx.name]);
        
        if (existing[0].count === 0) {
          console.log(`Adding index: ${idx.name}...`);
          await pool.query(`CREATE INDEX ${idx.name} ON mine_games(${idx.column})`);
          console.log(`✓ Added index ${idx.name}`);
        } else {
          console.log(`- Index ${idx.name} already exists, skipping`);
        }
      } catch (err) {
        // Index might already exist with different name, ignore
        console.log(`- Could not add index ${idx.name}: ${err.message}`);
      }
    }
    
    // Verify migration
    const [verify] = await pool.query(`
      SELECT 
        COLUMN_NAME, 
        DATA_TYPE, 
        IS_NULLABLE, 
        COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'mine_games'
        AND COLUMN_NAME LIKE 'payout%'
      ORDER BY COLUMN_NAME
    `);
    
    console.log('\n✓ Migration completed successfully!');
    console.log('\nPayout columns in mine_games table:');
    verify.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE}, nullable: ${col.IS_NULLABLE}, default: ${col.COLUMN_DEFAULT})`);
    });
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\nMigration script completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error);
    process.exit(1);
  });
