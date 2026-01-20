// backend/scripts/migrate_public_key_len.js
require("dotenv").config();

const { query } = require("../database/connection");

async function main() {
  const dbName = process.env.DB_NAME || "qubic_casino";

  // 1) Check current column length in the actual DB
  const rows = await query(
    `
    SELECT CHARACTER_MAXIMUM_LENGTH AS maxLen
    FROM information_schema.columns
    WHERE table_schema = ?
      AND table_name = 'mine_games'
      AND column_name = 'public_key'
    `,
    [dbName]
  );

  const maxLen = rows?.[0]?.maxLen ?? null;
  console.log("[migrate] mine_games.public_key maxLen:", maxLen);

  // 2) Fix schema if too small
  // Use VARCHAR(80) to be safe. (60 should also work if you're sure it's always 60.)
  if (!maxLen || Number(maxLen) < 60) {
    console.log("[migrate] Altering mine_games.public_key to VARCHAR(80)...");
    await query(
      `ALTER TABLE mine_games MODIFY public_key VARCHAR(80) NOT NULL`,
      []
    );
    console.log("[migrate] ✅ ALTER complete.");
  } else {
    console.log("[migrate] ✅ No ALTER needed.");
  }

  // 3) Delete corrupted LIVE games (already truncated, cannot be recovered)
  // This prevents cashout mismatch for those broken rows.
  const delResult = await query(
    `DELETE FROM mine_games WHERE status='LIVE' AND LENGTH(public_key) < 60`,
    []
  );

  // mysql2 returns an object for DELETE with affectedRows
  console.log("[migrate] Deleted corrupted LIVE games:", delResult?.affectedRows ?? delResult);

  // 4) Verify again
  const verify = await query(
    `
    SELECT CHARACTER_MAXIMUM_LENGTH AS maxLen
    FROM information_schema.columns
    WHERE table_schema = ?
      AND table_name = 'mine_games'
      AND column_name = 'public_key'
    `,
    [dbName]
  );
  console.log("[migrate] After migrate maxLen:", verify?.[0]?.maxLen ?? null);

  console.log("[migrate] ✅ Done.");
}

main().catch((err) => {
  console.error("[migrate] ❌ Failed:", err?.stack || err);
  process.exit(1);
});
