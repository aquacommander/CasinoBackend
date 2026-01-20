// backend/services/qubicTransfer.js
const axios = require("axios");
const { isValidQubicPublicId, normalizeQubicPublicId } = require("../utils/validation");

const QUBIC_RPC_URL = process.env.QUBIC_RPC_URL || "https://rpc.qubic.org";
const TICK_OFFSET = Number(process.env.TICK_OFFSET || 20);

function normalizeRpcBase(url) {
  const u = String(url || "").trim().replace(/\/+$/, "");
  if (u.endsWith("/v1")) return u.slice(0, -3);
  return u;
}

// --- Load QubicTransaction, PublicKey, Long classes ---
function loadQubicTypes() {
  const paths = [
    "@qubic-lib/qubic-ts-library/dist/qubic-types/QubicTransaction",
    "@qubic-lib/qubic-ts-library/dist/qubic-types/PublicKey",
    "@qubic-lib/qubic-ts-library/dist/qubic-types/Long",
    "qubic-ts-library/dist/qubic-types/QubicTransaction",
    "qubic-ts-library/dist/qubic-types/PublicKey",
    "qubic-ts-library/dist/qubic-types/Long",
    "@qubic-lib/qubic-ts-library",
    "qubic-ts-library",
  ];

  let QubicTransactionCtor = null;
  let PublicKeyCtor = null;
  let LongCtor = null;

  for (const p of paths) {
    try {
      const mod = require(p);
      if (!QubicTransactionCtor) {
        QubicTransactionCtor = mod.QubicTransaction || mod.default?.QubicTransaction || mod;
        if (typeof QubicTransactionCtor !== "function") QubicTransactionCtor = null;
      }
      if (!PublicKeyCtor) {
        PublicKeyCtor = mod.PublicKey || mod.default?.PublicKey;
        if (typeof PublicKeyCtor !== "function") PublicKeyCtor = null;
      }
      if (!LongCtor) {
        LongCtor = mod.Long || mod.default?.Long;
        if (typeof LongCtor !== "function") LongCtor = null;
      }
    } catch (_) {}
  }

  // Try direct imports
  if (!QubicTransactionCtor) {
    try {
      QubicTransactionCtor = require("@qubic-lib/qubic-ts-library").QubicTransaction;
    } catch (_) {}
  }
  if (!PublicKeyCtor) {
    try {
      PublicKeyCtor = require("@qubic-lib/qubic-ts-library").PublicKey;
    } catch (_) {}
  }
  if (!LongCtor) {
    try {
      LongCtor = require("@qubic-lib/qubic-ts-library").Long;
    } catch (_) {}
  }

  return { QubicTransactionCtor, PublicKeyCtor, LongCtor };
}

const { QubicTransactionCtor, PublicKeyCtor, LongCtor } = loadQubicTypes();

if (!QubicTransactionCtor || !PublicKeyCtor || !LongCtor) {
  console.error("Could not load QubicTransaction, PublicKey, or Long from qubic-ts-library");
}

async function getCurrentTick() {
  const base = normalizeRpcBase(QUBIC_RPC_URL);
  const url = `${base}/v1/tick-info`;
  const r = await axios.get(url, { timeout: 10_000 });

  const rawTick =
    r.data?.tickInfo?.tick ??
    r.data?.tick ??
    r.data?.currentTick ??
    r.data?.tickInfo?.currentTick;

  const tick = Number(rawTick);
  if (!Number.isFinite(tick) || tick <= 0) throw new Error("Invalid tick-info response");
  return tick;
}

async function signAndBroadcastQuTransfer({ seed, fromPublicId, toPublicId, amount }) {
  if (!seed) throw new Error("Missing seed");
  if (!fromPublicId) throw new Error("Missing fromPublicId");
  if (!toPublicId) throw new Error("Missing toPublicId");
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Amount must be positive integer");

  if (!QubicTransactionCtor || !PublicKeyCtor || !LongCtor) {
    throw new Error("Qubic TS library not available. Install @qubic-lib/qubic-ts-library");
  }

  const base = normalizeRpcBase(QUBIC_RPC_URL);
  const tick = await getCurrentTick();
  const targetTick = tick + TICK_OFFSET;

  // Normalize public IDs
  const fromId = normalizeQubicPublicId(fromPublicId);
  const toId = normalizeQubicPublicId(toPublicId);

  if (!isValidQubicPublicId(fromId) || !isValidQubicPublicId(toId)) {
    throw new Error("Invalid public ID format");
  }

  // Standard QU transfer: inputType=0, inputSize=0, no payload
  const tx = new QubicTransactionCtor()
    .setSourcePublicKey(new PublicKeyCtor(fromId))
    .setDestinationPublicKey(new PublicKeyCtor(toId))
    .setTick(targetTick)
    .setInputType(0)
    .setInputSize(0)
    .setAmount(new LongCtor(BigInt(amount)));

  // Signs tx using seed
  await tx.build(seed);

  // Get signed transaction bytes
  const signedTxBytes = tx.getPackageData ? tx.getPackageData() : tx.packageData;
  if (!signedTxBytes) {
    throw new Error("Failed to get signed transaction bytes");
  }

  // Encode to base64
  const signedTxBase64 = Buffer.from(signedTxBytes).toString("base64");

  const rpcRes = await axios.post(
    `${base}/v1/broadcast-transaction`,
    { encodedTransaction: signedTxBase64 },
    { headers: { "Content-Type": "application/json" }, timeout: 20_000 }
  );

  const txId =
    rpcRes.data?.transactionId ||
    rpcRes.data?.txId ||
    rpcRes.data?.id ||
    rpcRes.data?.hash;

  if (!txId) throw new Error("RPC did not return txId");

  return { txId, targetTick, rpcResponse: rpcRes.data };
}

async function payUserFromCasino({ toPublicId, amount }) {
  const seed = process.env.CASINO_SEED;
  const fromPublicId = process.env.CASINO_PUBLIC_ID;

  if (!seed) {
    throw new Error("CASINO_SEED environment variable not set");
  }
  if (!fromPublicId) {
    throw new Error("CASINO_PUBLIC_ID environment variable not set");
  }

  return signAndBroadcastQuTransfer({
    seed,
    fromPublicId,
    toPublicId,
    amount,
  });
}

module.exports = { payUserFromCasino, signAndBroadcastQuTransfer };
