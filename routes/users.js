const express = require("express");
const router = express.Router();
const { query } = require("../database/connection");
const { normalizeQubicPublicId, isValidQubicPublicId } = require("../utils/validation");

/**
 * GET /api/users/exists/:walletId
 * Returns { exists: boolean }
 */
router.get("/exists/:walletId", async (req, res) => {
  try {
    const walletId = normalizeQubicPublicId(req.params.walletId);
    if (!isValidQubicPublicId(walletId)) {
      return res.status(400).json({ error: "Invalid walletId (must be 60 A-Z characters)" });
    }

    const rows = await query("SELECT id FROM users WHERE wallet_id = ? LIMIT 1", [walletId]);
    return res.json({ exists: rows.length > 0 });
  } catch (e) {
    console.error("Error checking user existence:", e);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/users/register
 * Body: { walletId }
 * Creates user if not exists, returns user row
 */
router.post("/register", async (req, res) => {
  try {
    const walletId = normalizeQubicPublicId(req.body.walletId);
    if (!isValidQubicPublicId(walletId)) {
      return res.status(400).json({ error: "Invalid walletId (must be 60 A-Z characters)" });
    }

    // Create user if not exists; update last_login_at if exists
    await query(
      "INSERT INTO users (wallet_id) VALUES (?) ON DUPLICATE KEY UPDATE last_login_at = NOW()",
      [walletId]
    );

    const rows = await query(
      "SELECT id, wallet_id, status, created_at, last_login_at FROM users WHERE wallet_id = ? LIMIT 1",
      [walletId]
    );

    if (rows.length === 0) {
      return res.status(500).json({ error: "Failed to create user" });
    }

    return res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error("Error registering user:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
