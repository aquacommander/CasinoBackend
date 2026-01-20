const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { query } = require("../database/connection");
const { isValidQubicPublicId, normalizeQubicPublicId } = require("../utils/validation");
const { payFromCasinoToUser } = require("../services/qubicPayout");

console.log("✅ videoPoker routes loaded");

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function makeRng(seedStr) {
  let counter = 0;
  const seed = Buffer.from(seedStr, "utf8");
  return function nextFloat() {
    const msg = Buffer.from(String(counter++), "utf8");
    const h = crypto.createHmac("sha256", seed).update(msg).digest();
    const u32 = h.readUInt32BE(0);
    return u32 / 0x100000000;
  };
}

const SUITS = ["Hearts", "Diamonds", "Clubs", "Spades"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VALUE = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  "J": 11, "Q": 12, "K": 13, "A": 14,
};

function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({ rank: r, suit: s });
    }
  }
  return deck;
}

function shuffleDeck(deck, seedStr) {
  const rng = makeRng(seedStr);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function cardKey(c) {
  return `${c.rank}:${c.suit}`;
}

function cardToIndex(card) {
  const suitIndex = SUITS.indexOf(card.suit);
  const rankIndex = RANKS.indexOf(card.rank);
  if (suitIndex === -1 || rankIndex === -1) return 0;
  return suitIndex * 13 + rankIndex;
}

function indexToCard(index) {
  const idx = Number(index);
  const suitIndex = Math.floor(idx / 13);
  const rankIndex = idx % 13;
  return {
    rank: RANKS[rankIndex],
    suit: SUITS[suitIndex],
  };
}

function packHand(hand) {
  return Buffer.from(hand.map(cardToIndex));
}

function unpackHand(value) {
  if (!value) return null;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Array.from(buf.slice(0, 5)).map(indexToCard);
}

function toHoldMask(holdIndexes) {
  let mask = 0;
  for (const i of holdIndexes || []) {
    if (Number.isInteger(i) && i >= 0 && i <= 4) {
      mask |= 1 << i;
    }
  }
  return mask >>> 0;
}

function fromHoldMask(mask) {
  const result = [];
  const m = Number(mask) >>> 0;
  for (let i = 0; i < 5; i += 1) {
    if (((m >>> i) & 1) === 1) result.push(i);
  }
  return result;
}

function removeCards(deck, cardsToRemove) {
  const set = new Set(cardsToRemove.map(cardKey));
  return deck.filter((c) => !set.has(cardKey(c)));
}

function isFlush(hand) {
  const s = hand[0].suit;
  return hand.every((c) => c.suit === s);
}

function isStraight(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length !== 5) return false;
  const min = sorted[0];
  const max = sorted[4];
  if (max - min === 4) return true;
  // Check for wheel (A-2-3-4-5)
  const wheel = [2, 3, 4, 5, 14];
  return sorted.length === 5 && sorted.every((v, i) => v === wheel[i]);
}

function evaluateHand(hand) {
  const values = hand.map((c) => RANK_VALUE[c.rank]);
  const flush = isFlush(hand);
  const straight = isStraight(values);

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.values(counts).sort((a, b) => b - a);

  const sortedVals = [...values].sort((a, b) => a - b);
  const isRoyal = flush && straight && sortedVals.includes(14) && sortedVals.includes(10);

  if (isRoyal) return { result: "royal_flush", multiplier: 800 };
  if (flush && straight) return { result: "straight_flush", multiplier: 60 };
  if (groups[0] === 4) return { result: "4_of_a_kind", multiplier: 22 };
  if (groups[0] === 3 && groups[1] === 2) return { result: "full_house", multiplier: 9 };
  if (flush) return { result: "flush", multiplier: 6 };
  if (straight) return { result: "straight", multiplier: 4 };
  if (groups[0] === 3) return { result: "3_of_a_kind", multiplier: 3 };
  if (groups[0] === 2 && groups[1] === 2) return { result: "2_pair", multiplier: 2 };

  if (groups[0] === 2) {
    const pairValue = Number(Object.keys(counts).find((k) => counts[k] === 2));
    if (pairValue >= 11 || pairValue === 14) {
      return { result: "pair", multiplier: 1 };
    }
  }

  return { result: "no_win", multiplier: 0 };
}

function assertBetAmount(betAmount) {
  const n = Number(betAmount);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error("Invalid betAmount (must be positive integer).");
  }
  return n;
}

function assertHoldIndexes(holdIndexes) {
  if (!Array.isArray(holdIndexes)) {
    throw new Error("holdIndexes must be an array.");
  }
  const set = new Set();
  for (const x of holdIndexes) {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 0 || n > 4) {
      throw new Error("holdIndexes must be integers 0..4.");
    }
    set.add(n);
  }
  return [...set];
}

/**
 * POST /api/video-poker/init
 * Initialize a new video poker game
 * Body: { publicKey: string, betAmount: number, txId: string }
 * - Frontend already transferred bet to casino and sends txId (same as Mines createBet)
 */
router.post("/init", async (req, res) => {
  try {
    const { publicKey, publicId, betAmount, txId } = req.body;
    const wallet = publicKey || publicId || req.headers["x-public-id"];

    if (!wallet || typeof wallet !== "string") {
      return res.status(400).json({ error: "publicKey/publicId is required (string)" });
    }

    const pk = normalizeQubicPublicId(wallet);
    if (!isValidQubicPublicId(pk)) {
      return res.status(400).json({ error: "Invalid publicKey/publicId (must be 60 A-Z characters)" });
    }

    const bet = assertBetAmount(betAmount);
    if (!txId || typeof txId !== "string") {
      return res.status(400).json({ error: "txId is required (bet transfer tx)" });
    }

    // Mines-style: clear expired LIVE games
    await query(
      `UPDATE video_poker_sessions
         SET status='EXPIRED'
       WHERE wallet_public_key=? AND status='LIVE' AND expires_at IS NOT NULL AND expires_at < NOW()`,
      [pk]
    );

    const publicSeed = crypto.randomBytes(32).toString("hex");
    const privateSeed = crypto.randomBytes(32).toString("hex");
    const privateSeedHash = sha256Hex(privateSeed);

    // ✅ Fairness: shuffle with public + private (private unknown until after draw)
    const seedInit = `${publicSeed}:${privateSeed}:init`;
    const deck = shuffleDeck(buildDeck(), seedInit);
    const hand = deck.slice(0, 5);

    const insertRes = await query(
      `INSERT INTO video_poker_sessions
        (wallet_public_key, status, expires_at, public_seed, private_seed, private_seed_hash, initial_hand, bet_amount, bet_tx_id)
       VALUES (?, 'LIVE', DATE_ADD(NOW(), INTERVAL 5 MINUTE), ?, ?, ?, ?, ?, ?)`,
      [pk, publicSeed, privateSeed, privateSeedHash, packHand(hand), bet, txId]
    );

    console.log("✅ /init insertRes:", insertRes);

    // mysql libs differ: sometimes insertId is on the object, sometimes in [0]
    const gameId =
      insertRes?.insertId ??
      insertRes?.[0]?.insertId ??
      insertRes?.result?.insertId ??
      null;

    // Verify the insert actually happened
    const verify = await query(
      `SELECT id, wallet_public_key, status, expires_at FROM video_poker_sessions WHERE id=?`,
      [gameId]
    );
    console.log("✅ /init verify row:", verify);

    console.log("✅ /init created game:", {
      gameId,
      pk: pk.slice(0, 10) + "...",
      bet,
      txId: String(txId).slice(0, 10) + "...",
    });

    return res.json({ gameId, hand, publicSeed, privateSeedHash });
  } catch (e) {
    console.error("Error in /init:", e);
    return res.status(500).json({ error: e.message || "init failed" });
  }
});

/**
 * POST /api/video-poker/draw
 * Draw new cards (replace non-held cards) and finalize game
 * Body: { publicKey: string, holdIndexes: number[] }
 * - Backend finalizes, pays out immediately like Mines cashout
 */
router.post("/draw", async (req, res) => {
  try {
    const { publicKey, publicId, holdIndexes, gameId } = req.body;
    const wallet = publicKey || publicId || req.headers["x-public-id"];

    if (!wallet || typeof wallet !== "string") {
      return res.status(400).json({ error: "publicKey/publicId is required (string)" });
    }

    const pk = normalizeQubicPublicId(wallet);
    if (!isValidQubicPublicId(pk)) {
      return res.status(400).json({ error: "Invalid publicKey/publicId (must be 60 A-Z characters)" });
    }

    if (!gameId) {
      return res.status(400).json({ error: "gameId is required" });
    }

    const holds = assertHoldIndexes(holdIndexes || []);

    const rows = await query(
      `SELECT * FROM video_poker_sessions
       WHERE id=? AND wallet_public_key=? AND status='LIVE'
       LIMIT 1`,
      [Number(gameId), pk]
    );

    console.log("🎰 draw lookup:", { gameId, found: rows?.length || 0 });

    if (!rows || rows.length === 0) {
      return res.status(409).json({ error: "NO_LIVE_GAME" });
    }

    const game = rows[0];

    // Check if expired
    if (game.expires_at && new Date(game.expires_at).getTime() < Date.now()) {
      await query(`UPDATE video_poker_sessions SET status='EXPIRED' WHERE id=?`, [game.id]);
      return res.status(400).json({ error: "Game expired. Please deal again." });
    }

    // Idempotent safety: if somehow already ended
    if (game.result) {
      const initialHand = unpackHand(game.initial_hand);
      const finalHand = game.final_hand ? unpackHand(game.final_hand) : initialHand;
      return res.json({
        hand: finalHand,
        result: game.result,
        multiplier: game.multiplier || 0,
        payoutAmount: game.payout_amount || 0,
        profit: game.profit || 0,
        payoutTxId: game.payout_tx_id || null,
        publicSeed: game.public_seed,
        privateSeedHash: game.private_seed_hash,
        privateSeed: game.private_seed,
        holdIndexes: game.hold_mask !== null ? fromHoldMask(game.hold_mask) : null,
      });
    }

    const publicSeed = game.public_seed;
    const privateSeed = game.private_seed;

    const currentHand = unpackHand(game.initial_hand);

    // ✅ Fairness: shuffle with public + private for draw
    const seedDraw = `${publicSeed}:${privateSeed}:draw`;
    const deck = shuffleDeck(buildDeck(), seedDraw);
    const remaining = removeCards(deck, currentHand);

    const finalHand = currentHand.map((c, i) => {
      if (holds.includes(i)) return c;
      return remaining.shift();
    });

    const { result, multiplier } = evaluateHand(finalHand);
    const betAmount = Number(game.bet_amount);
    const payoutAmount = Math.floor(betAmount * multiplier);
    const profit = payoutAmount - betAmount;

    // ✅ Mines-style: pay from casino wallet to user IF payout > 0
    let payoutTxId = null;
    if (payoutAmount > 0) {
      try {
        const payoutTx = await payFromCasinoToUser({
          toPublicId: pk,
          amount: payoutAmount,
        });
        payoutTxId = payoutTx.txId;
      } catch (payoutError) {
        console.error("Payout error:", payoutError);
        // Don't fail the request, but log the error
        // The game will be marked as END but payoutTxId will be null
      }
    }

    await query(
      `UPDATE video_poker_sessions
         SET status='ENDED',
             final_hand=?,
             hold_mask=?,
             result=?,
             multiplier=?,
             payout_amount=?,
             profit=?,
             payout_tx_id=?
       WHERE id=?`,
      [
        packHand(finalHand),
        toHoldMask(holds),
        result,
        multiplier,
        payoutAmount,
        profit,
        payoutTxId,
        game.id,
      ]
    );

    return res.json({
      hand: finalHand,
      result,
      multiplier,
      payoutAmount,
      profit,
      payoutTxId,
      publicSeed,
      privateSeedHash: game.private_seed_hash,
      privateSeed, // reveal after draw
    });
  } catch (e) {
    console.error("Error in /draw:", e);
    return res.status(500).json({ error: e.message || "draw failed" });
  }
});

/**
 * POST /api/video-poker/fetchgame
 * Fetch the latest game (for resuming)
 * Body: { publicKey?: string, publicId?: string }
 * Headers: x-public-id (optional, fallback)
 */
router.post("/fetchgame", async (req, res) => {
  try {
    // ✅ Accept both publicKey and publicId (for consistency with Mines)
    const { publicKey, publicId } = req.body;
    const wallet = publicKey || publicId || req.headers["x-public-id"];

    if (!wallet || typeof wallet !== "string") {
      return res.status(400).json({ 
        error: "publicKey/publicId is required (string)",
        received: { publicKey: !!publicKey, publicId: !!publicId, header: !!req.headers["x-public-id"] }
      });
    }

    const pkRaw = wallet;
    const pk = normalizeQubicPublicId(pkRaw);
    
    if (!isValidQubicPublicId(pk)) {
      return res.status(400).json({ 
        error: "Invalid publicKey/publicId (must be 60 A-Z characters)",
        receivedLength: pkRaw.length,
        normalizedLength: pk.length
      });
    }

    const rows = await query(
      `SELECT * FROM video_poker_sessions
        WHERE wallet_public_key=? AND status='LIVE'
        ORDER BY id DESC
        LIMIT 1`,
      [pk]
    );

    if (rows && rows.length > 0) {
      const game = rows[0];
      
      // Check if expired
      if (game.expires_at && new Date(game.expires_at).getTime() < Date.now()) {
        // Mark as expired
        await query(`UPDATE video_poker_sessions SET status='EXPIRED' WHERE id=?`, [game.id]);
        return res.json({ hasGame: false, reason: "expired" });
      }
      
      if (game.initial_hand) {
        return res.json({
          hasGame: true,
          hand: unpackHand(game.initial_hand),
          publicSeed: game.public_seed,
          privateSeedHash: game.private_seed_hash,
        });
      }
    }

    return res.json({ hasGame: false });
  } catch (e) {
    console.error("Error in /fetchgame:", e);
    return res.status(500).json({ error: e.message || "fetchgame failed" });
  }
});

module.exports = router;
