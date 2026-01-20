// backend/services/qubicPayout.js
const axios = require("axios");

const QUBIC_RPC_URL = process.env.QUBIC_RPC_URL || "https://rpc.qubic.org";
const TICK_OFFSET = Number(process.env.TICK_OFFSET || 20);

function normalizeRpcBase(url) {
  const u = String(url || "").trim().replace(/\/+$/, "");
  if (u.endsWith("/v1")) return u.slice(0, -3);
  return u;
}

async function getCurrentTick() {
  const base = normalizeRpcBase(QUBIC_RPC_URL);
  const r = await axios.get(`${base}/v1/tick-info`, { timeout: 10_000 });
  const rawTick =
    r.data?.tickInfo?.tick ??
    r.data?.tick ??
    r.data?.currentTick ??
    r.data?.tickInfo?.currentTick;

  const tick = Number(rawTick);
  if (!Number.isFinite(tick) || tick <= 0) throw new Error("Invalid tick-info response");
  return tick;
}

// Dynamic loaders to match your tx.js style
function loadCtor(paths, exportNames) {
  for (const p of paths) {
    try {
      const mod = require(p);
      for (const name of exportNames) {
        const ctor = mod[name] || mod.default;
        if (typeof ctor === "function") return ctor;
      }
      if (typeof mod === "function") return mod;
    } catch (_) {}
  }
  return null;
}

const QubicTransactionCtor = loadCtor(
  [
    "@qubic-lib/qubic-ts-library/dist/qubic-types/QubicTransaction",
    "qubic-ts-library/dist/qubic-types/QubicTransaction",
    "@qubic-lib/qubic-ts-library/dist/qubicTransaction",
    "qubic-ts-library/dist/qubicTransaction",
  ],
  ["QubicTransaction"]
);

const PublicKeyCtor = loadCtor(
  [
    "@qubic-lib/qubic-ts-library/dist/qubic-types/PublicKey",
    "qubic-ts-library/dist/qubic-types/PublicKey",
    "@qubic-lib/qubic-ts-library/dist/publicKey",
    "qubic-ts-library/dist/publicKey",
  ],
  ["PublicKey"]
);

const LongCtor = loadCtor(
  [
    "@qubic-lib/qubic-ts-library/dist/qubic-types/Long",
    "qubic-ts-library/dist/qubic-types/Long",
    "@qubic-lib/qubic-ts-library/dist/long",
    "qubic-ts-library/dist/long",
  ],
  ["Long"]
);

async function payFromCasinoToUser({ toPublicId, amount }) {
  const seed = process.env.CASINO_SEED;
  const fromPublicId = process.env.CASINO_PUBLIC_ID;

  if (!seed || !fromPublicId) {
    throw new Error("CASINO_SEED / CASINO_PUBLIC_ID missing in .env");
  }
  if (!QubicTransactionCtor || !PublicKeyCtor || !LongCtor) {
    throw new Error("Qubic TS library classes not found. Install @qubic-lib/qubic-ts-library");
  }
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be positive integer");

  const tick = await getCurrentTick();
  const targetTick = tick + TICK_OFFSET;

  const tx = new QubicTransactionCtor()
    .setSourcePublicKey(new PublicKeyCtor(fromPublicId))
    .setDestinationPublicKey(new PublicKeyCtor(toPublicId))
    .setTick(targetTick)
    .setInputType(0)
    .setInputSize(0)
    .setAmount(new LongCtor(BigInt(amount)));

  // Sign transaction with seed
  await tx.build(seed);

  // Get signed transaction bytes and encode to base64
  const signedTxBytes = tx.getPackageData ? tx.getPackageData() : tx.packageData;
  if (!signedTxBytes) {
    throw new Error("Failed to get signed transaction bytes");
  }
  const encodedTransaction = Buffer.from(signedTxBytes).toString("base64");

  const base = normalizeRpcBase(QUBIC_RPC_URL);
  const rpcRes = await axios.post(
    `${base}/v1/broadcast-transaction`,
    { encodedTransaction },
    { headers: { "Content-Type": "application/json" }, timeout: 20_000 }
  );

  // If RPC returns an error payload, treat as failure (no usable tx)
  if (rpcRes.data?.error || rpcRes.data?.message?.includes?.("error")) {
    throw new Error(`RPC broadcast error: ${JSON.stringify(rpcRes.data)}`);
  }

  const txId =
    rpcRes.data?.transactionId ||
    rpcRes.data?.txId ||
    rpcRes.data?.id ||
    rpcRes.data?.hash;

  if (!txId) throw new Error("RPC did not return txId");
  return { txId, targetTick, rpcResponse: rpcRes.data };
}

module.exports = { payFromCasinoToUser };
