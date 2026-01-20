const { SlideGame } = require('../models/Game');
const { query } = require('../database/connection'); // ✅ for cleanup queries
const crypto = require('crypto');
const { payFromCasinoToUser } = require('../services/qubicPayout');
const { normalizeQubicPublicId } = require('../utils/validation');

/**
 * Slide Game Socket.io Namespace
 * Handles /slide namespace
 *
 * Key fixes:
 * 1) Do NOT store the full "numbers" array in MySQL (it can be huge and fill the DB).
 * 2) Keep full numbers in memory only for the current round.
 * 3) Store only a small capped preview (or empty []) in DB.
 * 4) Periodically cleanup old ended games to prevent DB growth forever.
 */
module.exports = function (io) {
  const slideNamespace = io.of('/slide');

  let currentGame = null;
  let cycleStarted = false; // Lock to prevent multiple game cycles
  const usedTxIds = new Set(); // Global txId tracking to prevent replay across rounds

  const STATUS = {
    WAITTING: 0,
    STARTING: 1,
    BETTING: 2,
    PLAYING: 3,
  };

  // How many points to ever send/store (prevents UI freeze + DB bloat)
  const MAX_POINTS = Number(process.env.SLIDE_MAX_POINTS || 1500);

  // How many ended games to keep (prevents infinite DB growth)
  const KEEP_ENDED_GAMES = Number(process.env.SLIDE_KEEP_ENDED_GAMES || 50);

  // Generate crash point and numbers array
  function generateSlideData(publicSeed, privateSeed) {
    const combined = publicSeed + privateSeed;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');

    // Generate crash point
    const hashNum = parseInt(hash.slice(0, 8), 16);
    const random = (hashNum % 1000000) / 1000000;
    const crashPoint = Math.max(
      1.0,
      Math.min(1000.0, parseFloat((1 + random * 999).toFixed(2)))
    );

    // Generate numbers array (simulated sliding numbers)
    const numbers = [];
    let current = 1.0;
    while (current < crashPoint) {
      numbers.push(parseFloat(current.toFixed(2)));
      current += 0.01 + Math.random() * 0.05;
    }
    numbers.push(crashPoint);

    return { crashPoint, numbers };
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Cleanup old ended games to prevent DB from filling up
  async function cleanupOldEndedGames() {
    try {
      // Keep only last KEEP_ENDED_GAMES ended games.
      // MySQL does not allow parameter placeholders for LIMIT/OFFSET.
      const offset = Math.max(0, Number(KEEP_ENDED_GAMES) - 1);
      if (!Number.isFinite(offset)) return;

      const cutoffRows = await query(
        `SELECT created_at
         FROM slide_rounds
         WHERE status = ?
         ORDER BY created_at DESC
         LIMIT 1 OFFSET ${offset}`,
        [STATUS.WAITTING]
      );

      if (!cutoffRows || cutoffRows.length === 0) return;
      const cutoff = cutoffRows[0].created_at;
      if (!cutoff) return;

      await query(
        `DELETE FROM slide_rounds
         WHERE status = ?
           AND created_at < ?`,
        [STATUS.WAITTING, cutoff]
      );
    } catch (err) {
      // Non-fatal
      console.warn('[SLIDE] cleanupOldEndedGames warning:', err?.message || err);
    }
  }

  // Create a new game
  async function createNewGame() {
    const publicSeed = crypto.randomBytes(32).toString('hex');
    const privateSeed = crypto.randomBytes(32).toString('hex');
    const privateHash = crypto.createHash('sha256').update(privateSeed).digest('hex');

    const { crashPoint, numbers } = generateSlideData(publicSeed, privateSeed);

    // ✅ Keep full numbers in memory only (never store in DB)
    const runtimeNumbers = numbers;

    // ✅ Store only a small preview OR empty []
    // Storing huge JSON arrays will quickly fill your Railway MySQL storage.
    const numbersPreview = Array.isArray(runtimeNumbers)
      ? runtimeNumbers.slice(0, MAX_POINTS)
      : [];

    const gameData = {
      _id: crypto.randomBytes(16).toString('hex'),
      status: STATUS.STARTING,
      crashPoint,
      numbers: numbersPreview, // ✅ capped (digest only stored in DB)
      publicSeed,
      privateSeed,
      privateHash,
      players: [],
      createdAt: new Date(),
    };

    const game = await SlideGame.create(gameData);

    // Attach runtime-only numbers (not saved to DB)
    game._runtimeNumbers = runtimeNumbers;

    return game;
  }

  // Ensure cycle is started (with lock)
  function ensureCycle() {
    if (cycleStarted) return;
    cycleStarted = true;
    startGameCycle();
  }

  // Start game cycle - locked to prevent multiple instances
  async function startGameCycle() {
    while (true) {
      try {
        // Initial wait period
        await wait(2000);

        // Create new game
        currentGame = await createNewGame();

        // 1) STARTING
        currentGame.status = STATUS.STARTING;
        await currentGame.save();
        slideNamespace.emit('slide-track', {
          status: STATUS.STARTING,
          _id: currentGame._id,
          publicSeed: currentGame.publicSeed,
          privateHash: currentGame.privateHash,
        });

        // 2) BETTING window
        await wait(15000);
        currentGame.status = STATUS.BETTING;
        await currentGame.save();
        slideNamespace.emit('slide-track', {
          status: STATUS.BETTING,
          _id: currentGame._id,
        });

        // 3) PLAYING
        await wait(1000);
        currentGame.status = STATUS.PLAYING;
        await currentGame.save();

        // Prefer runtime numbers (full), fallback to DB preview
        const sourceNumbers =
          currentGame._runtimeNumbers || currentGame.numbers || [];

        const safeNumbers = Array.isArray(sourceNumbers)
          ? sourceNumbers.slice(0, MAX_POINTS)
          : [];

        slideNamespace.emit('slide-track', {
          status: STATUS.PLAYING,
          crashPoint: currentGame.crashPoint,
          numbers: safeNumbers,
          players: currentGame.players,
        });

        // Wait for game to finish (simulate slide duration)
        await wait(5000);

        // Calculate payouts and pay winners
        const players = currentGame.players || [];
        const crashPoint = currentGame.crashPoint;

        for (const player of players) {
          if (player.status === 'playing' && player.publicId) {
            if (crashPoint >= player.target) {
              const winAmount = Math.floor(player.betAmount * player.target);
              if (winAmount > 0) {
                try {
                  console.log(`[SLIDE] Paying ${winAmount} to ${player.publicId}`);
                  const payoutResult = await payFromCasinoToUser({
                    toPublicId: player.publicId,
                    amount: winAmount,
                  });
                  player.status = 'won';
                  player.winAmount = winAmount;
                  player.payoutTxId = payoutResult.txId;
                  console.log(`[SLIDE] Payout successful, txId: ${payoutResult.txId}`);
                } catch (payoutError) {
                  console.error('[SLIDE] Payout error:', payoutError);
                  player.status = 'lost';
                  player.winAmount = 0;
                }
              } else {
                player.status = 'lost';
                player.winAmount = 0;
              }
            } else {
              player.status = 'lost';
              player.winAmount = 0;
            }
          }
        }

        // 4) END / WAITING
        currentGame.status = STATUS.WAITTING;
        await currentGame.save();

        slideNamespace.emit('game-end', {
          crashPoint: currentGame.crashPoint,
          players: players.map((p) => ({
            playerId: p.playerId,
            publicId: p.publicId,
            status: p.status,
            winAmount: p.winAmount || 0,
            payoutTxId: p.payoutTxId || null,
          })),
        });

        // ✅ cleanup old ended games to keep DB small
        await cleanupOldEndedGames();

        // Clear current game reference (and runtime array)
        currentGame = null;

        // Wait before next cycle
        await wait(2000);
      } catch (error) {
        console.error('Error in startGameCycle:', error);
        await wait(10000);
      }
    }
  }

  // Helper to get wallet from socket
  function getSocketWallet(socket) {
    return normalizeQubicPublicId(
      socket.data?.publicId ||
        socket.handshake?.auth?.publicId ||
        socket.handshake?.query?.publicId
    );
  }

  slideNamespace.on('connection', (socket) => {
    console.log('Client connected to /slide:', socket.id);

    // Auth handler to store publicId
    socket.on('auth', (data) => {
      const publicId = normalizeQubicPublicId(data?.publicId || data?.publicKey);
      if (publicId) socket.data.publicId = publicId;
    });

    // Send current game state
    socket.on('games', async () => {
      try {
        ensureCycle();

        const game =
          currentGame ||
          (await SlideGame.findOne({
            status: { $in: [STATUS.STARTING, STATUS.BETTING, STATUS.PLAYING] },
          }));

        if (game) {
          // Cap numbers array when sending game state
          const safeNumbers = Array.isArray(game.numbers)
            ? game.numbers.slice(0, MAX_POINTS)
            : [];

          socket.emit('slide-track', {
            status: game.status,
            _id: game._id,
            publicSeed: game.publicSeed,
            privateHash: game.privateHash,
            crashPoint: game.crashPoint,
            numbers: safeNumbers,
            players: game.players,
          });
        }

        // Send history (ended games)
        const history = await SlideGame.find({
          status: STATUS.WAITTING,
          select: 'id, crash_point',
          limit: 6,
          sort: { createdAt: -1 },
        });

        socket.emit(
          'history',
          history.map((g) => ({
            _id: g._id || g.id,
            resultpoint: g.crashPoint || g.crash_point,
          }))
        );
      } catch (error) {
        console.error('Error fetching games:', error);
      }
    });

    // Join game
    socket.on('join-game', async (payload) => {
      try {
        if (!currentGame || currentGame.status !== STATUS.BETTING) {
          socket.emit('game-join-error', 'Game not accepting bets');
          return;
        }

        if (typeof payload !== 'object' || !payload) {
          socket.emit('game-join-error', 'Invalid payload');
          return;
        }

        const { target, betAmount, currencyId, txId } = payload;

        if (!txId || typeof txId !== 'string') {
          socket.emit('game-join-error', 'Missing txId (transaction required)');
          return;
        }

        const publicId = getSocketWallet(socket);
        if (!publicId) {
          socket.emit('game-join-error', 'Wallet not connected (missing publicId)');
          return;
        }

        const targetNum = Math.floor(Number(target));
        const betAmountNum = Math.floor(Number(betAmount));

        if (!Number.isFinite(targetNum) || targetNum <= 0) {
          socket.emit('game-join-error', 'Invalid target');
          return;
        }
        if (!Number.isFinite(betAmountNum) || betAmountNum <= 0) {
          socket.emit('game-join-error', 'Invalid bet amount');
          return;
        }

        const players = currentGame.players || [];

        // Prevent duplicate bets in same round
        if (players.some((p) => p.publicId === publicId)) {
          socket.emit('game-join-error', 'You already joined this round');
          return;
        }

        // Prevent tx replay (within same round)
        if (players.some((p) => p.txId === txId)) {
          socket.emit('game-join-error', 'Transaction already used in this round');
          return;
        }

        // Prevent tx replay across rounds (global check)
        if (usedTxIds.has(txId)) {
          socket.emit('game-join-error', 'Transaction already used in a previous round');
          return;
        }

        const player = {
          playerId: socket.id,
          publicId: publicId,
          betAmount: betAmountNum,
          target: targetNum,
          currencyId: currencyId || '',
          txId: txId,
          status: 'playing',
          joinedAt: new Date().toISOString(),
        };

        currentGame.players.push(player);
        await currentGame.save();

        usedTxIds.add(txId);

        socket.emit('game-join-sucess', player);
        slideNamespace.emit('bet', player);
      } catch (error) {
        console.error('Error joining game:', error);
        socket.emit('game-join-error', error.message);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected from /slide:', socket.id);
    });
  });

  // Start the first game
  ensureCycle();

  return slideNamespace;
};
