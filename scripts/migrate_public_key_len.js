// backend/scripts/migrate_public_key_len.js
const { loadEnv, getDbName } = require("../database/dbConfig");
const { query } = require("../database/connection");

loadEnv();

async function main() {
  const dbName = getDbName();

  const targets = [
    { table: 'wallets', column: 'public_key' },
    { table: 'mine_sessions', column: 'wallet_public_key' },
    { table: 'video_poker_sessions', column: 'wallet_public_key' },
    { table: 'bets', column: 'wallet_public_key' },
  ];

  for (const target of targets) {
    const rows = await query(
      `
      SELECT CHARACTER_MAXIMUM_LENGTH AS maxLen
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
        AND column_name = ?
      `,
      [dbName, target.table, target.column]
    );

    const maxLen = rows?.[0]?.maxLen ?? null;
    console.log(`[migrate] ${target.table}.${target.column} maxLen:`, maxLen);

    if (!maxLen || Number(maxLen) < 60) {
      console.log(`[migrate] Altering ${target.table}.${target.column} to VARCHAR(80)...`);
      await query(
        `ALTER TABLE ${target.table} MODIFY ${target.column} VARCHAR(80) NOT NULL`,
        []
      );
      console.log("[migrate] ✅ ALTER complete.");
    } else {
      console.log("[migrate] ✅ No ALTER needed.");
    }
  }

  // Mark corrupted LIVE mine sessions as EXPIRED (already truncated, cannot be recovered)
  const delResult = await query(
    `UPDATE mine_sessions SET status='EXPIRED' WHERE status='LIVE' AND LENGTH(wallet_public_key) < 60`,
    []
  );

  console.log("[migrate] Marked corrupted LIVE mine sessions:", delResult?.affectedRows ?? delResult);

  console.log("[migrate] ✅ Done.");
}

main().catch((err) => {
  console.error("[migrate] ❌ Failed:", err?.stack || err);
  process.exit(1);
});
