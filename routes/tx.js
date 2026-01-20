/**
 * Transaction Routes
 * Builds a REAL Qubic unsigned transfer tx (binary), Snap signs it, then we broadcast.
 */
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { isValidQubicPublicId, normalizeQubicPublicId } = require("../utils/validation");

const QUBIC_RPC_URL = process.env.QUBIC_RPC_URL || "https://rpc.qubic.org";
const TICK_OFFSET = Number(process.env.TICK_OFFSET || 20);

function normalizeRpcBase(url) {
  const u = String(url || "").trim().replace(/\/+$/, "");
  if (u.endsWith("/v1")) return u.slice(0, -3);
  return u;
}

// --- Load PublicKey class ---
function loadPublicKeyCtor() {
  const paths = [
    "@qubic-lib/qubic-ts-library/dist/qubic-types/PublicKey",
    "@qubic-lib/qubic-ts-library/dist/publicKey",
    "qubic-ts-library/dist/qubic-types/PublicKey",
    "qubic-ts-library/dist/publicKey",
    "@qubic-lib/qubic-ts-library",
    "qubic-ts-library",
  ];

  for (const p of paths) {
    try {
      const mod = require(p);
      const ctor = mod.PublicKey || mod.default || mod;
      if (typeof ctor === "function") return ctor;
    } catch (_) {}
  }
  return null;
}

const PublicKeyCtor = loadPublicKeyCtor();

if (!PublicKeyCtor) {
  console.error("Could not load PublicKey from Qubic TS library");
}

async function getCurrentTick() {
  const base = normalizeRpcBase(QUBIC_RPC_URL);
  const url = `${base}/v1/tick-info`;
  const r = await axios.get(url, { timeout: 10_000 });
  const data = r.data;

  const rawTick =
    data?.tickInfo?.tick ??
    data?.tick ??
    data?.currentTick ??
    data?.tickInfo?.currentTick;

  const tick = Number(rawTick);
  if (!Number.isFinite(tick) || tick <= 0) {
    console.error("tick-info unexpected response:", data);
    throw new Error("Invalid tick-info response");
  }
  return tick;
}

// --- constants for standard QU transfer ---
const PUBLIC_KEY_LEN = 32;
const TX_HEADER_SIZE = 32 + 32 + 8 + 4 + 2 + 2; // 80 bytes
const SIG_LEN = 64;

/**
 * Convert Qubic identity (60-char string) to 32-byte public key bytes
 */
function publicIdToPublicKeyBytes(publicId) {
  if (!PublicKeyCtor) {
    throw new Error("PublicKey class not available in qubic-ts-library");
  }

  try {
    // Create PublicKey from identity string
    const pk = new PublicKeyCtor(publicId);

    // IMPORTANT: Call build() before getting package data
    if (typeof pk.build === "function") {
      pk.build();
    }

    // Extract 32-byte public key bytes
    const data =
      (typeof pk.getPackageData === "function" ? pk.getPackageData() : null) ||
      (typeof pk.getData === "function" ? pk.getData() : null) ||
      pk.packageData ||
      pk.data;

    if (!data) {
      throw new Error("Failed to extract public key bytes from PublicKey");
    }

    const u8 = Uint8Array.from(data);
    if (u8.length !== PUBLIC_KEY_LEN) {
      throw new Error(`Public key length invalid: ${u8.length} (expected 32)`);
    }

    return u8;
  } catch (error) {
    throw new Error(`Failed to convert publicId to public key bytes: ${error.message}`);
  }
}

/**
 * POST /api/tx/build-transfer
 * Body: { fromId: string, toId: string, amount: number }
 * Returns: { unsignedTxBase64: string, finalTick: number, signatureOffset: number, signatureLength: number, expectedSignedBytes: number }
 */
router.post("/build-transfer", async (req, res) => {
  try {
    if (!PublicKeyCtor) {
      return res.status(500).json({
        error: "Qubic TS library missing",
        message: "Install @qubic-lib/qubic-ts-library in backend",
      });
    }

    const fromId = normalizeQubicPublicId(req.body?.fromId || "");
    const toId = normalizeQubicPublicId(req.body?.toId || "");
    const amount = Number(req.body?.amount);

    if (!isValidQubicPublicId(fromId)) return res.status(400).json({ error: "Invalid fromId" });
    if (!isValidQubicPublicId(toId)) return res.status(400).json({ error: "Invalid toId" });
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive integer" });
    }

    const currentTick = await getCurrentTick();
    const finalTick = currentTick + TICK_OFFSET;

    // Convert identities to 32-byte public key bytes
    const fromPub = publicIdToPublicKeyBytes(fromId);
    const toPub = publicIdToPublicKeyBytes(toId);

    // Build UNSIGNED header (80 bytes). Signature will be appended later.
    const tx = new Uint8Array(TX_HEADER_SIZE);
    const dv = new DataView(tx.buffer);

    let o = 0;
    tx.set(fromPub, o); o += PUBLIC_KEY_LEN;
    tx.set(toPub, o);   o += PUBLIC_KEY_LEN;

    dv.setBigInt64(o, BigInt(amount), true); o += 8;
    dv.setUint32(o, finalTick, true);        o += 4;
    dv.setUint16(o, 0, true);                o += 2; // inputType
    dv.setUint16(o, 0, true);                o += 2; // inputSize

    res.json({
      unsignedTxBase64: Buffer.from(tx).toString("base64"),
      finalTick,
      signatureOffset: TX_HEADER_SIZE, // 80
      signatureLength: SIG_LEN,        // 64
      expectedSignedBytes: TX_HEADER_SIZE + SIG_LEN, // 144
      rpc: QUBIC_RPC_URL,
    });
  } catch (error) {
    console.error("Error building transfer transaction:", error);
    return res.status(500).json({ error: "Failed to build transfer transaction", message: error.message });
  }
});

/**
 * POST /api/tx/broadcast
 * Body: { signedTxBase64: string }
 * Returns: { txId: string, rpcResponse: object }
 */
router.post("/broadcast", async (req, res) => {
  try {
    const signedTxBase64 = String(req.body?.signedTxBase64 || "").trim();
    if (!signedTxBase64) return res.status(400).json({ error: "signedTxBase64 required" });

    // validate base64
    Buffer.from(signedTxBase64, "base64");

    const base = normalizeRpcBase(QUBIC_RPC_URL);

    const rpcRes = await axios.post(
      `${base}/v1/broadcast-transaction`,
      { encodedTransaction: signedTxBase64 },
      { headers: { "Content-Type": "application/json" }, timeout: 20_000 }
    );

    // IMPORTANT: log full response once while debugging
    // console.log("broadcast response:", rpcRes.data);

    const txId =
      rpcRes.data?.transactionId ||
      rpcRes.data?.txId ||
      rpcRes.data?.id ||
      rpcRes.data?.hash;

    if (!txId) {
      return res.status(502).json({ error: "RPC did not return txId", rpcResponse: rpcRes.data });
    }

    res.json({ txId, rpcResponse: rpcRes.data });
  } catch (error) {
    const details = error.response?.data || error.message;
    console.error("Error broadcasting transaction:", details);
    return res.status(500).json({ error: "Failed to broadcast transaction", message: error.message, details });
  }
});

/**
 * GET /api/tx/status/:txId
 * Verify transaction exists on-chain (or pending/unknown)
 */
router.get("/status/:txId", async (req, res) => {
  try {
    const txId = String(req.params.txId || "").trim();
    if (!txId) return res.status(400).json({ error: "txId required" });

    const base = normalizeRpcBase(QUBIC_RPC_URL);
    const r = await axios.get(`${base}/v1/transactions/${txId}`, { timeout: 20_000 });
    res.json(r.data);
  } catch (error) {
    const details = error.response?.data || error.message;
    res.status(error.response?.status || 500).json({ error: "Failed to fetch tx status", details });
  }
});

module.exports = router;
