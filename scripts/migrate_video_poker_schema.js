/**
 * Migration script: Ensure columns for video_poker_sessions
 * Run with: node backend/scripts/migrate_video_poker_schema.js
 */

const { query } = require('../database/connection');

async function columnExists(table, column) {
  const rows = await query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [table, column]
  );
  return rows && rows.length > 0;
}

async function ensureColumn(table, column, definition) {
  if (await columnExists(table, column)) {
    console.log(`  ✓ ${column} already exists`);
    return;
  }
  console.log(`  ➕ Adding ${column}...`);
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`  ✅ Added ${column}`);
}

async function indexExists(table, indexName) {
  const rows = await query(
    `
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    `,
    [table, indexName]
  );
  return rows && rows.length > 0;
}

async function migrate() {
  const table = 'video_poker_sessions';
  console.log(`🔄 Starting ${table} table migration...`);

  try {
    await ensureColumn(table, 'status', "ENUM('LIVE','ENDED','EXPIRED') NOT NULL DEFAULT 'LIVE'");
    await ensureColumn(table, 'expires_at', 'TIMESTAMP NULL');
    await ensureColumn(table, 'hold_mask', 'TINYINT UNSIGNED NULL');
    await ensureColumn(table, 'bet_tx_id', 'VARCHAR(128) NULL');
    await ensureColumn(table, 'multiplier', 'INT NULL');
    await ensureColumn(table, 'payout_amount', 'BIGINT NULL');
    await ensureColumn(table, 'profit', 'BIGINT NULL');
    await ensureColumn(table, 'payout_tx_id', 'VARCHAR(128) NULL');
    await ensureColumn(
      table,
      'updated_at',
      'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    );
    await ensureColumn(table, 'initial_hand', 'VARBINARY(5) NOT NULL');
    await ensureColumn(table, 'final_hand', 'VARBINARY(5) NULL');

    const indexName = 'idx_wallet_status_created';
    if (!(await indexExists(table, indexName))) {
      console.log(`  ➕ Adding index ${indexName}...`);
      await query(`CREATE INDEX ${indexName} ON ${table} (wallet_public_key, status, created_at)`);
      console.log(`  ✅ Added index ${indexName}`);
    } else {
      console.log(`  ✓ index ${indexName} already exists`);
    }

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
