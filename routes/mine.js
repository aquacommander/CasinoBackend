const express = require('express');
const router = express.Router();
const { MineGame } = require('../models/Game');
const { query } = require('../database/connection');
const crypto = require('crypto');
const { isValidQubicPublicId, normalizeQubicPublicId } = require('../utils/validation');
const { calculateMinesPayout } = require('../services/minesPayout');
const { payFromCasinoToUser } = require('../services/qubicPayout');

console.log("✅ mine routes loaded");

// ---- Mines helpers (for autobet - reuse existing endpoint logic) ----

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function recordMineMove(sessionId, cell, hitMine) {
  try {
    await query(
      `INSERT INTO mine_moves (session_id, cell, hit_mine)
       VALUES (?, ?, ?)`,
      [Number(sessionId), Number(cell), hitMine ? 1 : 0]
    );
  } catch (err) {
    console.warn('Mine move record failed:', err?.message || err);
  }
}

function buildInitialDatas(mines) {
  // Initialize game data (25 slots: 0-24)
  const datas = Array.from({ length: 25 }, (_, i) => ({
    point: i,
    mine: null,
    mined: false
  }));

  // Randomly place mines
  const minePositions = [];
  while (minePositions.length < mines) {
    const pos = Math.floor(Math.random() * 25);
    if (!minePositions.includes(pos)) minePositions.push(pos);
  }

  const finalDatas = datas.map((item, index) => ({
    ...item,
    mine: minePositions.includes(index) ? 'BOMB' : 'GEM'
  }));

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  return { datas: finalDatas, expiresAt };
}

function parseDatasMaybeString(datas) {
  return typeof datas === 'string' ? JSON.parse(datas) : datas;
}

function countRevealedGems(datas) {
  const parsed = parseDatasMaybeString(datas);
  return parsed.filter(d => d.mined && d.mine === 'GEM').length;
}

function applyPickToDatas(gameDatas, tileIndex) {
  const datas = parseDatasMaybeString(gameDatas);

  const slotIndex = datas.findIndex(d => d.point === tileIndex);
  if (slotIndex === -1) {
    const err = new Error('Invalid tile index');
    err.statusCode = 400;
    throw err;
  }

  // If already opened, just return current state (same as your /mine/pick)
  if (datas[slotIndex].mined) {
    return {
      status: 'BET',
      hitMine: false,
      opened: datas.filter(d => d.mined).map(d => d.point),
      datas
    };
  }

  datas[slotIndex].mined = true;
  const isBomb = datas[slotIndex].mine === 'BOMB';

  if (isBomb) {
    return {
      status: 'END',
      hitMine: true,
      opened: datas.filter(d => d.mined).map(d => d.point),
      datas
    };
  }

  // Check if all safe slots are opened
  const allSafeMined = datas
    .filter(d => d.mine === 'GEM')
    .every(d => d.mined);

  if (allSafeMined) {
    return {
      status: 'END',
      hitMine: false,
      opened: datas.filter(d => d.mined).map(d => d.point),
      datas
    };
  }

  return {
    status: 'BET',
    hitMine: false,
    opened: datas.filter(d => d.mined).map(d => d.point),
    datas
  };
}

// Internal wrappers (reuse DB model methods exactly like your routes)
async function createMineGameInternal({ publicId, mines, amount, txId }) {
  await MineGame.deleteExpiredLiveGames(publicId);

  // Optional safety: prevent collisions
  const active = await MineGame.findOne({
    publicKey: publicId,
    status: 'LIVE',
    expiresAt: { $gt: new Date() }
  });
  if (active) {
    const err = new Error('Active LIVE game exists. Finish it before autobet.');
    err.statusCode = 409;
    throw err;
  }

  const { datas, expiresAt } = buildInitialDatas(mines);

  const publicSeed = crypto.randomBytes(32).toString('hex');
  const privateSeed = crypto.randomBytes(32).toString('hex');
  const privateSeedHash = sha256Hex(privateSeed);

  const gameData = {
    publicKey: String(publicId),
    status: 'LIVE',
    mines: Number(mines),
    amount: Number(amount),
    datas,
    txId: txId ? String(txId) : null,
    expiresAt,
    publicSeed,
    privateSeed,
    privateSeedHash
  };

  return await MineGame.create(gameData);
}

async function pickMineTileInternal({ publicId, gameId, index }) {
  const game = await MineGame.findOne({ id: gameId });
  if (!game) {
    const err = new Error('Game not found');
    err.statusCode = 404;
    throw err;
  }
  if (String(game.publicKey) !== String(publicId)) {
    const err = new Error('Not your game');
    err.statusCode = 403;
    throw err;
  }
  if (game.status !== 'LIVE') {
    const err = new Error('Game is not LIVE');
    err.statusCode = 409;
    throw err;
  }
  if (game.expiresAt && new Date(game.expiresAt) <= new Date()) {
    const err = new Error('Game expired');
    err.statusCode = 409;
    throw err;
  }

  const result = applyPickToDatas(game.datas, index);

  const updateData = { datas: result.datas };
  if (result.status === 'END') updateData.status = 'ENDED';

  await recordMineMove(game.id, index, result.hitMine);

  await MineGame.findByIdAndUpdate(game.id, updateData);

  return { ...result, gameId: game.id };
}

async function cashoutMineGameInternal({ publicId, gameId }) {
  const game = await MineGame.findOne({ id: gameId });
  if (!game) {
    const err = new Error('Game not found');
    err.statusCode = 404;
    throw err;
  }
  if (String(game.publicKey) !== String(publicId)) {
    const err = new Error('Not your game');
    err.statusCode = 403;
    throw err;
  }

  // IMPORTANT: Your /mine/pick marks END when all safe gems are opened.
  // So cashout must allow LIVE or END (if not already paid).
  if (game.status !== 'LIVE' && game.status !== 'ENDED') {
    const err = new Error('Game is not cashout-eligible');
    err.statusCode = 409;
    throw err;
  }

  // prevent double cashout if already paid
  if (game.payoutAmount && Number(game.payoutAmount) > 0 && game.payoutTxId) {
    const err = new Error('Game already cashed out');
    err.statusCode = 409;
    throw err;
  }

  const datas = parseDatasMaybeString(game.datas);
  const revealedGems = countRevealedGems(datas);

  const payout = calculateMinesPayout({
    mines: Number(game.mines),
    revealedGems,
    betAmount: Number(game.amount),
  });

  if (payout.payoutAmount <= 0) {
    const err = new Error('Cashout requires at least 1 revealed GEM');
    err.statusCode = 400;
    throw err;
  }

  // 1) End game in DB first (prevents double cashout)
  await MineGame.findByIdAndUpdate(game.id, {
    status: 'ENDED',
    payoutAmount: payout.payoutAmount,
  });

  // 2) Pay user from casino hot wallet
  let payoutTx;
  try {
    payoutTx = await payFromCasinoToUser({
      toPublicId: publicId,
      amount: payout.payoutAmount,
    });
  } catch (payoutError) {
    // Revert game status if payout fails and record failure
    await MineGame.findByIdAndUpdate(game.id, { 
      status: 'LIVE',
      payoutStatus: 'FAILED',
      payoutError: String(payoutError?.message || payoutError)
    });
    throw payoutError;
  }

  // 3) Store payout txId + status
  await MineGame.findByIdAndUpdate(game.id, { 
    payoutTxId: payoutTx.txId,
    payoutStatus: 'SENT',
    payoutError: null
  });

  return {
    status: 'END',
    payoutAmount: payout.payoutAmount,
    payoutTxId: payoutTx.txId,
    revealedGems
  };
}

// Test route to verify mine routes are loaded
router.get('/test', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Mine routes are loaded and working',
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/mine/status
 * Check active mine game status
 * Body: { publicId: string (60 uppercase A-Z characters) }
 */
router.post('/status', async (req, res) => {
  try {
    const publicId = normalizeQubicPublicId(req.body.publicId || req.headers['x-public-id']);

    if (!isValidQubicPublicId(publicId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Qubic publicId (identity). It must be exactly 60 A–Z characters.'
      });
    }

    const game = await MineGame.findOne({
      publicKey: publicId,
      status: 'LIVE',
      expiresAt: { $gt: new Date() }
    });

    if (game) {
      res.json({
        success: true,
        datas: game.datas,
        amount: game.amount,
        mines: game.mines,
        gameId: game.id
      });
    } else {
      res.json({
        success: false
      });
    }
  } catch (error) {
    console.error('Error checking mine game status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/mine/create
 * Create a new mine game
 * Body: { publicId: string (60 uppercase A-Z characters), mines: number, amount: number (integer), txId?: string }
 */
router.post('/create', async (req, res, next) => {
  try {
    // Log request body for debugging
    console.log('POST /api/mine/create body:', JSON.stringify(req.body, null, 2));

    const { mines, amount, publicKey, publicId } = req.body ?? {};
    // ✅ Accept both publicKey and publicId (for consistency with cashout)
    const wallet = publicKey || publicId || req.headers['x-public-id'];
    
    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({
        status: 'ERROR',
        error: 'publicKey/publicId is required (string)'
      });
    }
    
    const publicIdNormalized = normalizeQubicPublicId(wallet);

    if (!isValidQubicPublicId(publicIdNormalized)) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid Qubic publicId/publicKey (identity). It must be exactly 60 A–Z characters.'
      });
    }

    // Validate mines - Qubic has NO decimals → enforce integer
    if (!Number.isInteger(mines) || mines < 1 || mines > 24) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid mines count (must be integer between 1-24)'
      });
    }

    // Validate amount - Qubic has NO decimals → enforce integer
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'amount must be a positive integer (Qubic has no decimals)'
      });
    }
    
    const amountInt = amount; // Already validated as integer

    // Check for existing active game (delete expired games)
    await MineGame.deleteExpiredLiveGames(publicIdNormalized);

    // Initialize game data (25 slots: 0-24)
    const datas = Array.from({ length: 25 }, (_, i) => ({
      point: i,
      mine: null,
      mined: false
    }));

    // Randomly place mines
    const minePositions = [];
    while (minePositions.length < mines) {
      const pos = Math.floor(Math.random() * 25);
      if (!minePositions.includes(pos)) {
        minePositions.push(pos);
      }
    }

    // Optional: Get transaction ID if provided
    const txId = req.body.txId ? String(req.body.txId).trim() : null;

    // Ensure all values are proper types before creating game
    // IMPORTANT: All values must be primitives (string, number, null)
    const publicSeed = crypto.randomBytes(32).toString('hex');
    const privateSeed = crypto.randomBytes(32).toString('hex');
    const privateSeedHash = sha256Hex(privateSeed);

    const gameData = {
      publicKey: String(publicIdNormalized),  // Ensure string (stored as wallet_public_key in DB)
      status: 'LIVE',
      mines: Number(mines),  // Ensure number (already validated as integer)
      amount: Number(amountInt),  // Ensure number (already validated as integer)
      datas: datas.map((item, index) => ({
        ...item,
        mine: minePositions.includes(index) ? 'BOMB' : 'GEM'
      })),
      txId: txId ? String(txId) : null,  // Ensure string or null
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes - will be converted to string in create()
      publicSeed,
      privateSeed,
      privateSeedHash
    };

    // Log the game data before creating
    console.log('Creating game with data:', {
      publicKey: gameData.publicKey,
      status: gameData.status,
      mines: gameData.mines,
      amount: gameData.amount,
      datasLength: gameData.datas.length,
      txId: gameData.txId,
      expiresAt: gameData.expiresAt
    });

    const game = await MineGame.create(gameData);

    // ✅ Safety check: Verify publicKey was stored correctly (prevents truncation issues)
    if (!game.publicKey || game.publicKey.length !== 60) {
      console.error("❌ wallet_public_key stored incorrectly:", { 
        publicKey: game.publicKey, 
        length: game.publicKey?.length 
      });
      return res.status(500).json({ 
        status: 'ERROR',
        error: 'wallet_public_key storage error - database column may be too short' 
      });
    }

    res.json({
      status: 'BET',
      gameId: game.id,
      txId: game.txId || null,
      datas: game.datas // Return initial game data for frontend initialization
    });
  } catch (error) {
    console.error('Error creating mine game:', error);
    // Pass error to global error handler
    next(error);
  }
});

/**
 * POST /api/mine/bet
 * Reveal a tile (place a bet on a specific point)
 * Body: { publicId: string (60 uppercase A-Z characters), point: number }
 */
router.post('/bet', async (req, res) => {
  try {
    const { point } = req.body;
    const publicId = normalizeQubicPublicId(req.body.publicId || req.headers['x-public-id']);

    if (!isValidQubicPublicId(publicId)) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid Qubic publicId (identity). It must be exactly 60 A–Z characters.'
      });
    }

    if (point === undefined || !Number.isInteger(point) || point < 0 || point >= 25) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid point (must be integer 0-24)'
      });
    }

    const game = await MineGame.findOne({
      publicKey: publicId,
      status: 'LIVE',
      expiresAt: { $gt: new Date() }
    });

    if (!game) {
      return res.status(404).json({
        status: 'ERROR',
        error: 'No active game found'
      });
    }

    // Find and update the slot
    const slotIndex = game.datas.findIndex(d => d.point === point);
    if (slotIndex === -1 || game.datas[slotIndex].mined) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid or already mined slot'
      });
    }

    // Update the datas array
    game.datas[slotIndex].mined = true;
    const isBomb = game.datas[slotIndex].mine === 'BOMB';

    // Prepare update data
    const updateData = {
      datas: game.datas
    };

    await recordMineMove(game.id, tileIndex, isBomb);

    await recordMineMove(game.id, tileIndex, isBomb);

    await recordMineMove(game.id, point, isBomb);

    if (isBomb) {
      // Game over - hit a bomb
      updateData.status = 'ENDED';
      await MineGame.findByIdAndUpdate(game.id, updateData);

      res.json({
        status: 'END',
        datas: game.datas
      });
    } else {
      // Check if all safe slots are mined
      const allSafeMined = game.datas
        .filter(d => d.mine === 'GEM')
        .every(d => d.mined);

      if (allSafeMined) {
        // Game won - all safe slots mined
        updateData.status = 'ENDED';
        await MineGame.findByIdAndUpdate(game.id, updateData);

        res.json({
          status: 'END',
          datas: game.datas
        });
      } else {
        // Continue game
        await MineGame.findByIdAndUpdate(game.id, updateData);

        res.json({
          status: 'BET',
          datas: game.datas
        });
      }
    }
  } catch (error) {
    console.error('Error placing mine bet:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

/**
 * POST /api/mine/pick
 * Pick/reveal a tile (click a tile during game)
 * Body: { gameId: number, index: number } OR { publicId: string, point: number }
 * Security: Verifies requester owns the game
 */
router.post('/pick', async (req, res) => {
  try {
    const { gameId, index, publicId, point } = req.body;
    const publicIdHeader = req.headers['x-public-id'];
    const requesterPublicId = normalizeQubicPublicId(publicId || publicIdHeader);

    // Support both gameId and publicId for finding the game
    let game;
    if (gameId) {
      game = await MineGame.findOne({ id: gameId });
    } else if (requesterPublicId && isValidQubicPublicId(requesterPublicId)) {
      game = await MineGame.findOne({
        publicKey: requesterPublicId,
        status: 'LIVE',
        expiresAt: { $gt: new Date() }
      });
    } else {
      return res.status(400).json({
        status: 'ERROR',
        error: 'gameId or valid publicId is required'
      });
    }

    if (!game) {
      return res.status(404).json({ 
        status: 'ERROR',
        error: 'Game not found' 
      });
    }

    // Security: Verify game owner matches requester
    if (requesterPublicId && isValidQubicPublicId(requesterPublicId) && game.publicKey !== requesterPublicId) {
      return res.status(403).json({ 
        status: 'ERROR',
        error: 'Game does not belong to requester' 
      });
    }

    if (game.status !== 'LIVE') {
      return res.status(400).json({ 
        status: 'ERROR',
        error: `Game is ${game.status}` 
      });
    }

    // Support both 'index' and 'point' for tile position
    const tileIndex = index !== undefined ? Number(index) : (point !== undefined ? Number(point) : null);
    if (tileIndex === null || !Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= 25) {
      return res.status(400).json({ 
        status: 'ERROR',
        error: 'Invalid index/point (must be integer 0-24)' 
      });
    }

    // Find and update the slot
    const slotIndex = game.datas.findIndex(d => d.point === tileIndex);
    if (slotIndex === -1) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid tile index'
      });
    }

    if (game.datas[slotIndex].mined) {
      return res.json({
        status: 'BET',
        gameId: game.id,
        opened: game.datas.filter(d => d.mined).map(d => d.point),
        hitMine: false,
        datas: game.datas
      });
    }

    // Update the datas array
    game.datas[slotIndex].mined = true;
    const isBomb = game.datas[slotIndex].mine === 'BOMB';

    // Prepare update data
    const updateData = {
      datas: game.datas
    };

    if (isBomb) {
      // Game over - hit a bomb
      updateData.status = 'ENDED';
      await MineGame.findByIdAndUpdate(game.id, updateData);

      res.json({
        status: 'END',
        gameId: game.id,
        opened: game.datas.filter(d => d.mined).map(d => d.point),
        hitMine: true,
        datas: game.datas
      });
    } else {
      // Check if all safe slots are mined
      const allSafeMined = game.datas
        .filter(d => d.mine === 'GEM')
        .every(d => d.mined);

      if (allSafeMined) {
        // Game won - all safe slots mined
        updateData.status = 'ENDED';
        await MineGame.findByIdAndUpdate(game.id, updateData);

        res.json({
          status: 'END',
          gameId: game.id,
          opened: game.datas.filter(d => d.mined).map(d => d.point),
          hitMine: false,
          datas: game.datas
        });
      } else {
        // Continue game
        await MineGame.findByIdAndUpdate(game.id, updateData);

        res.json({
          status: 'BET',
          gameId: game.id,
          opened: game.datas.filter(d => d.mined).map(d => d.point),
          hitMine: false,
          datas: game.datas
        });
      }
    }
  } catch (error) {
    console.error('Error picking tile:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

/**
 * POST /api/mine/reveal
 * Reveal a tile (alternative endpoint, same functionality as /pick)
 * Body: { gameId: number, index: number } OR { publicId: string, point: number }
 * Security: Verifies requester owns the game
 */
router.post('/reveal', async (req, res) => {
  try {
    const { gameId, index, publicId, point } = req.body;
    const publicIdHeader = req.headers['x-public-id'];
    const requesterPublicId = normalizeQubicPublicId(publicId || publicIdHeader);

    // Support both gameId and publicId for finding the game
    let game;
    if (gameId) {
      game = await MineGame.findOne({ id: gameId });
    } else if (requesterPublicId && isValidQubicPublicId(requesterPublicId)) {
      game = await MineGame.findOne({
        publicKey: requesterPublicId,
        status: 'LIVE',
        expiresAt: { $gt: new Date() }
      });
    } else {
      return res.status(400).json({
        status: 'ERROR',
        error: 'gameId or valid publicId is required'
      });
    }

    if (!game) {
      return res.status(404).json({ 
        status: 'ERROR',
        error: 'Game not found' 
      });
    }

    // Security: Verify game owner matches requester
    if (requesterPublicId && isValidQubicPublicId(requesterPublicId) && game.publicKey !== requesterPublicId) {
      return res.status(403).json({ 
        status: 'ERROR',
        error: 'Game does not belong to requester' 
      });
    }

    if (game.status !== 'LIVE') {
      return res.status(400).json({ 
        status: 'ERROR',
        error: `Game is ${game.status}` 
      });
    }

    // Support both 'index' and 'point' for tile position
    const tileIndex = index !== undefined ? Number(index) : (point !== undefined ? Number(point) : null);
    if (tileIndex === null || !Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= 25) {
      return res.status(400).json({ 
        status: 'ERROR',
        error: 'Invalid index/point (must be integer 0-24)' 
      });
    }

    // Find and update the slot
    const slotIndex = game.datas.findIndex(d => d.point === tileIndex);
    if (slotIndex === -1) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid tile index'
      });
    }

    if (game.datas[slotIndex].mined) {
      return res.json({
        status: 'BET',
        gameId: game.id,
        opened: game.datas.filter(d => d.mined).map(d => d.point),
        hitMine: false,
        datas: game.datas
      });
    }

    // Update the datas array
    game.datas[slotIndex].mined = true;
    const isBomb = game.datas[slotIndex].mine === 'BOMB';

    // Prepare update data
    const updateData = {
      datas: game.datas
    };

    if (isBomb) {
      // Game over - hit a bomb
      updateData.status = 'ENDED';
      await MineGame.findByIdAndUpdate(game.id, updateData);

      res.json({
        status: 'END',
        gameId: game.id,
        opened: game.datas.filter(d => d.mined).map(d => d.point),
        hitMine: true,
        datas: game.datas
      });
    } else {
      // Check if all safe slots are mined
      const allSafeMined = game.datas
        .filter(d => d.mine === 'GEM')
        .every(d => d.mined);

      if (allSafeMined) {
        // Game won - all safe slots mined
        updateData.status = 'ENDED';
        await MineGame.findByIdAndUpdate(game.id, updateData);

        res.json({
          status: 'END',
          gameId: game.id,
          opened: game.datas.filter(d => d.mined).map(d => d.point),
          hitMine: false,
          datas: game.datas
        });
      } else {
        // Continue game
        await MineGame.findByIdAndUpdate(game.id, updateData);

        res.json({
          status: 'BET',
          gameId: game.id,
          opened: game.datas.filter(d => d.mined).map(d => d.point),
          hitMine: false,
          datas: game.datas
        });
      }
    }
  } catch (error) {
    console.error('Error revealing tile:', error);
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

/**
 * POST /api/mine/cashout
 * Cashout from current game - calculates payout and sends QU transfer from casino to user
 * Body: { gameId: number, publicId?: string, publicKey?: string } (publicId or publicKey required, 60 uppercase A-Z characters)
 * Security: Always requires requesterPublicId to match game owner
 */
router.post('/cashout', async (req, res) => {
  try {
    console.log("💰 CASHOUT request body:", JSON.stringify(req.body, null, 2));

    // ✅ Accept both publicId and publicKey (for compatibility)
    const { gameId, publicId, publicKey } = req.body;
    const wallet = publicKey || publicId || req.headers['x-public-id'];
    
    if (!gameId || !wallet) {
      return res.status(400).json({ 
        status: 'ERROR', 
        error: 'gameId and publicKey/publicId are required' 
      });
    }

    const requesterPublicId = normalizeQubicPublicId(wallet);

    if (!isValidQubicPublicId(requesterPublicId)) {
      return res.status(400).json({ status: 'ERROR', error: 'Invalid Qubic publicId/publicKey' });
    }

    const gameIdNum = Number(gameId);
    if (!Number.isInteger(gameIdNum) || gameIdNum <= 0) {
      return res.status(400).json({ status: 'ERROR', error: 'gameId is required (integer)' });
    }

    console.log("🔍 Looking up game:", { gameId: gameIdNum, requesterPublicId });
    const game = await MineGame.findOne({ id: gameIdNum });
      if (!game) {
      console.error("❌ Game not found:", gameIdNum);
      return res.status(404).json({ status: 'ERROR', error: 'Game not found' });
    }

    // ✅ IMPORTANT: owner field from MySQL is wallet_public_key -> mapped to publicKey
    const owner = normalizeQubicPublicId(game.publicKey || '');
    if (!isValidQubicPublicId(owner)) {
      console.error("❌ Game owner public key invalid:", { publicKey: game.publicKey });
      return res.status(500).json({
          status: 'ERROR', 
        error: 'Game owner public key is missing/invalid in DB',
        debug: { publicKey: game.publicKey }
        });
      }
      
    // ✅ Block stealing other users' games
    if (owner !== requesterPublicId) {
      console.error("❌ Ownership mismatch:", { owner, requesterPublicId });
        return res.status(403).json({ 
          status: 'ERROR', 
        error: 'Forbidden: not your game',
        debug: { owner, requesterPublicId }
      });
    }

    // ✅ Parse datas if it's stored as JSON string in MySQL
    const datas = typeof game.datas === 'string' ? JSON.parse(game.datas) : game.datas;

    // ✅ Idempotent: if already ended, just return success (no 403/404)
    if (game.status !== 'LIVE') {
      console.log("✅ Game already ended, returning existing state");
      return res.status(200).json({
        status: 'END',
        gameId: game.id,
        opened: datas.filter(d => d.mined).map(d => d.point),
        datas,
        payoutTxId: game.payoutTxId || null,
        payoutAmount: game.payoutAmount || null,
        multiplier: game.multiplier || null,
      });
    }

    const revealedGems = datas.filter(d => d.mined && d.mine === 'GEM').length;
    console.log("💎 Revealed gems:", revealedGems);

    const payout = calculateMinesPayout({
      mines: game.mines,
      revealedGems,
      betAmount: game.amount,
    });

    console.log("💰 Calculated payout:", { 
      payoutAmount: payout.payoutAmount, 
      multiplier: payout.multiplier,
      betAmount: game.amount 
    });

    if (payout.payoutAmount <= 0) {
      return res.status(400).json({ status: 'ERROR', error: 'Cashout requires at least 1 revealed GEM' });
    }

    // 1) End game in DB first (prevents double cashout)
    console.log("💾 Updating game status to ENDED");
    await MineGame.findByIdAndUpdate(game.id, {
      status: 'ENDED',
      payoutAmount: payout.payoutAmount,
      revealedGems,
    });

    // 2) Pay user from casino hot wallet
    console.log("💸 Sending payout:", { to: owner, amount: payout.payoutAmount, token: "QU" });
    let payoutTx;
    try {
      payoutTx = await payFromCasinoToUser({
        toPublicId: owner,
        amount: payout.payoutAmount,
      });
      console.log("✅ Payout transaction successful:", { txId: payoutTx.txId, targetTick: payoutTx.targetTick });
    } catch (payoutError) {
      console.error("❌ Payout transaction failed:", payoutError?.stack || payoutError);
      // Revert game status if payout fails (optional - you may want to keep it as END)
      await MineGame.findByIdAndUpdate(game.id, {
        status: 'LIVE', // Revert to LIVE so user can retry
        payoutStatus: 'FAILED',
        payoutError: String(payoutError?.message || payoutError)
      });
      throw payoutError;
    }

    // 3) Store payout txId (optional but recommended)
    await MineGame.findByIdAndUpdate(game.id, { 
      payoutTxId: payoutTx.txId,
      payoutStatus: 'SENT',
      payoutError: null
    });

    const updatedGame = await MineGame.findOne({ id: game.id });
    const updatedDatas = typeof updatedGame.datas === 'string' ? JSON.parse(updatedGame.datas) : updatedGame.datas;

    console.log("✅ Cashout completed successfully");
    return res.json({
      status: 'END',
      gameId: game.id,
      opened: updatedDatas.filter(d => d.mined).map(d => d.point),
      datas: updatedDatas,
      payoutAmount: payout.payoutAmount,
      multiplier: payout.multiplier,
      payoutTxId: payoutTx.txId,
      payoutTick: payoutTx.targetTick,
    });
  } catch (error) {
    console.error("❌ CASHOUT FAILED:", error?.stack || error);
    console.error("Error details:", {
      message: error?.message,
      name: error?.name,
      code: error?.code,
    });
    return res.status(500).json({ 
      status: 'ERROR', 
      error: error?.message || 'cashout failed',
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

/**
 * POST /api/mine/autobet
 * Auto bet on multiple points - plays one complete round (create → reveal all points → cashout or bust)
 * Body: { publicId: string, points: number[], mines: number, amount: number, txId?: string }
 * Returns: { status: "END", outcome: "WIN"|"LOSS", profit, payoutAmount, multiplier, datas, ... }
 */
router.post('/autobet', async (req, res) => {
  try {
    const publicId = normalizeQubicPublicId(req.body.publicId || req.headers['x-public-id']);

    if (!isValidQubicPublicId(publicId)) {
      return res.status(400).json({
        status: 'ERROR',
        error: 'Invalid Qubic publicId (identity). It must be exactly 60 A–Z characters.'
      });
    }

    const mines = Math.floor(Number(req.body.mines));
    const amount = Math.floor(Number(req.body.amount));
    const txId = req.body.txId || null;

    const pointsRaw = Array.isArray(req.body.points) ? req.body.points : [];
    const points = [...new Set(pointsRaw.map(n => Math.floor(Number(n))))].filter(n => n >= 0 && n <= 24);

    // ---- Validate inputs ----
    if (!Number.isFinite(mines) || mines < 1 || mines > 24) {
      return res.status(400).json({ status: 'ERROR', error: 'mines must be 1..24' });
    }
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ status: 'ERROR', error: 'amount must be a positive integer' });
    }
    if (points.length < 1) {
      return res.status(400).json({ status: 'ERROR', error: 'points must contain at least one tile index (0..24)' });
    }

    const maxPicks = 25 - mines;
    if (points.length > maxPicks) {
      return res.status(400).json({
        status: 'ERROR',
        error: `Too many points for ${mines} mines. Max picks is ${maxPicks}.`
      });
    }

    // ---- Create game (same as /mine/create) ----
    const game = await createMineGameInternal({ publicId, mines, amount, txId });
    const gameId = game.id;

    // ---- Reveal all points (same as repeating /mine/pick) ----
    let lastDatas = parseDatasMaybeString(game.datas);
    let endedEarly = false;
    let hitMine = false;

    for (const index of points) {
      const pickRes = await pickMineTileInternal({ publicId, gameId, index });
      lastDatas = pickRes.datas;

      if (pickRes.status === 'END') {
        endedEarly = true;
        hitMine = !!pickRes.hitMine;
        break;
      }
    }

    // If bomb hit -> LOSS (no cashout)
    if (endedEarly && hitMine) {
      return res.json({
        status: 'END',
        outcome: 'LOSS',
        gameId,
        publicId,
        amount,
        mines,
        pickedPoints: points,
        hitMine: true,
        payoutAmount: 0,
        multiplier: 0,
        profit: -amount,
        datas: lastDatas
      });
    }

    // Otherwise -> cashout immediately (WIN)
    const cash = await cashoutMineGameInternal({ publicId, gameId });

    const payoutAmount = Math.floor(Number(cash.payoutAmount || 0));
    const profit = payoutAmount - amount;

    return res.json({
      status: 'END',
      outcome: 'WIN',
      gameId,
      publicId,
      amount,
      mines,
      pickedPoints: points,
      hitMine: false,
      payoutAmount,
      multiplier: cash.multiplier ?? null,
      profit,
      payoutTxId: cash.payoutTxId ?? null,
      datas: lastDatas
    });

  } catch (error) {
    console.error('Error in autobet:', error);
    res.status(error.statusCode || 500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

/**
 * POST /api/mine/claim
 * Claim payout for a failed payout (retry mechanism)
 * Body: { gameId: number } OR { publicId: string }
 * Only allowed when payoutStatus === 'FAILED' and game ended safely (no bomb)
 */
router.post('/claim', async (req, res) => {
  try {
    const publicIdHeader = req.headers['x-public-id'];
    const requesterPublicId = normalizeQubicPublicId(req.body.publicId || publicIdHeader);

    if (!isValidQubicPublicId(requesterPublicId)) {
      return res.status(400).json({ 
        status: 'ERROR', 
        error: 'Invalid Qubic publicId' 
      });
    }

    const { gameId } = req.body || {};

    // Find game owned by requester with FAILED payout
    const game = await MineGame.findOne({
      ...(gameId ? { id: gameId } : {}),
      publicKey: requesterPublicId,
      payoutStatus: 'FAILED',
    });

    if (!game) {
      return res.status(404).json({ 
        status: 'ERROR', 
        error: 'No failed payout found for this game' 
      });
    }

    // Security: Verify game owner
    if (game.publicKey !== requesterPublicId) {
      return res.status(403).json({ 
        status: 'ERROR', 
        error: 'Game does not belong to requester' 
      });
    }

    // Check if game ended safely (no bomb hit)
    const hitBomb = game.datas.some(d => d.mined && d.mine === 'BOMB');
    if (hitBomb) {
      return res.status(400).json({ 
        status: 'ERROR', 
        error: 'Cannot claim payout for games where a bomb was hit' 
      });
    }

    // Retry payout
    if (!game.payoutAmount || game.payoutAmount <= 0) {
      return res.status(400).json({ 
        status: 'ERROR', 
        error: 'Invalid payout amount' 
      });
    }

    // Mark as pending again
    await MineGame.findByIdAndUpdate(game.id, {
      payoutStatus: 'PENDING',
      payoutError: null,
    });

    // Retry payout transfer
    let payoutTx;
    try {
      payoutTx = await payUserFromCasino({
        toPublicId: game.publicKey,
        amount: game.payoutAmount,
      });
    } catch (e) {
      await MineGame.findByIdAndUpdate(game.id, {
        payoutStatus: 'FAILED',
        payoutError: String(e?.message || e),
      });
      return res.status(502).json({ 
        status: 'ERROR', 
        error: 'Payout retry failed', 
        details: e.message 
      });
    }

    // Mark as paid
    await MineGame.findByIdAndUpdate(game.id, {
      payoutStatus: 'SENT',
      payoutTxId: payoutTx.txId,
      payoutError: null,
    });

    return res.json({
      status: 'SUCCESS',
      gameId: game.id,
      payoutAmount: game.payoutAmount,
      payoutTxId: payoutTx.txId,
      payoutTick: payoutTx.targetTick,
    });
  } catch (error) {
    console.error('Error claiming payout:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      error: error.message 
    });
  }
});

module.exports = router;
