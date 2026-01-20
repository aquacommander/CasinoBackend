/**
 * Migration script: Add missing columns to video_poker_games table
 * Run with: node backend/scripts/migrate_video_poker_schema.js
 */

const { query } = require('../database/connection');

async function migrate() {
  console.log('🔄 Starting video_poker_games table migration...');

  try {
    // Check if status column exists
    const columns = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'status'
    `);

    if (!columns || columns.length === 0) {
      console.log('  ➕ Adding status column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'LIVE'`);
      console.log('  ✅ Added status column');
    } else {
      console.log('  ✓ status column already exists');
    }

    // Add expires_at
    const expiresAt = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'expires_at'
    `);
    if (!expiresAt || expiresAt.length === 0) {
      console.log('  ➕ Adding expires_at column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN expires_at DATETIME NULL`);
      console.log('  ✅ Added expires_at column');
    } else {
      console.log('  ✓ expires_at column already exists');
    }

    // Add hold_indexes
    const holdIndexes = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'hold_indexes'
    `);
    if (!holdIndexes || holdIndexes.length === 0) {
      console.log('  ➕ Adding hold_indexes column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN hold_indexes JSON NULL`);
      console.log('  ✅ Added hold_indexes column');
    } else {
      console.log('  ✓ hold_indexes column already exists');
    }

    // Add bet_tx_id
    const betTxId = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'bet_tx_id'
    `);
    if (!betTxId || betTxId.length === 0) {
      console.log('  ➕ Adding bet_tx_id column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN bet_tx_id VARCHAR(128) NULL`);
      console.log('  ✅ Added bet_tx_id column');
    } else {
      console.log('  ✓ bet_tx_id column already exists');
    }

    // Add multiplier
    const multiplier = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'multiplier'
    `);
    if (!multiplier || multiplier.length === 0) {
      console.log('  ➕ Adding multiplier column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN multiplier INT NULL`);
      console.log('  ✅ Added multiplier column');
    } else {
      console.log('  ✓ multiplier column already exists');
    }

    // Add payout_amount
    const payoutAmount = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'payout_amount'
    `);
    if (!payoutAmount || payoutAmount.length === 0) {
      console.log('  ➕ Adding payout_amount column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN payout_amount BIGINT NULL`);
      console.log('  ✅ Added payout_amount column');
      
      // Migrate data from old 'payout' column if it exists
      const payoutCol = await query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'video_poker_games' 
        AND COLUMN_NAME = 'payout'
      `);
      if (payoutCol && payoutCol.length > 0) {
        console.log('  🔄 Migrating data from payout to payout_amount...');
        await query(`UPDATE video_poker_games SET payout_amount = payout WHERE payout_amount IS NULL AND payout IS NOT NULL`);
        console.log('  ✅ Migrated payout data');
      }
    } else {
      console.log('  ✓ payout_amount column already exists');
    }

    // Add profit
    const profit = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'profit'
    `);
    if (!profit || profit.length === 0) {
      console.log('  ➕ Adding profit column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN profit BIGINT NULL`);
      console.log('  ✅ Added profit column');
    } else {
      console.log('  ✓ profit column already exists');
    }

    // Add payout_tx_id
    const payoutTxId = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'payout_tx_id'
    `);
    if (!payoutTxId || payoutTxId.length === 0) {
      console.log('  ➕ Adding payout_tx_id column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN payout_tx_id VARCHAR(128) NULL`);
      console.log('  ✅ Added payout_tx_id column');
    } else {
      console.log('  ✓ payout_tx_id column already exists');
    }

    // Add updated_at
    const updatedAt = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND COLUMN_NAME = 'updated_at'
    `);
    if (!updatedAt || updatedAt.length === 0) {
      console.log('  ➕ Adding updated_at column...');
      await query(`ALTER TABLE video_poker_games ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
      console.log('  ✅ Added updated_at column');
    } else {
      console.log('  ✓ updated_at column already exists');
    }

    // Check if index exists
    const indexes = await query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'video_poker_games' 
      AND INDEX_NAME = 'idx_public_key_status_created'
    `);
    if (!indexes || indexes.length === 0) {
      console.log('  ➕ Adding index idx_public_key_status_created...');
      await query(`CREATE INDEX idx_public_key_status_created ON video_poker_games (public_key, status, created_at)`);
      console.log('  ✅ Added index');
    } else {
      console.log('  ✓ index idx_public_key_status_created already exists');
    }

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
