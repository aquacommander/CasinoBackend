const crypto = require("crypto");
const { CrashGame } = require("../models/Game");
const { payFromCasinoToUser } = require("../services/qubicPayout");

const GAME_STATUS = {
  NotStarted: 1,
  Starting: 2,
  InProgress: 3,
  Over: 4,
  Blocking: 5,
  Refunded: 6,
};

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * Provably-fair crash point (deterministic from seeds).
 * IMPORTANT: your frontend "fairness verify" must use the SAME algorithm.
 */
function crashPointFromSeeds(publicSeed, privateSeed) {
  // HMAC(privateSeed, publicSeed)
  const h = crypto.createHmac("sha256", privateSeed).update(publicSeed).digest("hex");

  // first 52 bits = 13 hex chars
  const r = BigInt("0x" + h.slice(0, 13));
  const E = 1n << 52n;

  // crash * 100 as bigint
  let crash100 = ((100n * E) - r) / (E - r);

  // clamp to 1000.00x max (optional)
  const MAX100 = 100000n; // 1000.00x
  if (crash100 > MAX100) crash100 = MAX100;

  let crash = Number(crash100) / 100;
  if (!Number.isFinite(crash) || crash < 1) crash = 1;
  return Math.floor(crash * 100) / 100;
}

function normalizeWalletId(v) {
  if (!v) return "";
  return String(v).trim();
}

module.exports = function initCrash(io) {
  // ✅ MUST MATCH FRONTEND: /crashx
  const nsp = io.of("/crashx");

  // ---- Tunables ----
  const STARTING_MS = 5000; // countdown duration
  const TICK_MS = 50;       // tick frequency
  const GROWTH_RATE = 0.00012; // exponential growth: payout = exp(rate * elapsedMs)

  // ---- Runtime state (in-memory) ----
  let currentGame = null;
  let history = [];
  let tickTimer = null;
  let startTimer = null;
  let plannedStartAt = 0;
  let startedAtMs = 0;
  let currentPayout = 1.0;
  let crashPoint = 0;

  function safeEmitGames(socket) {
    const now = Date.now();

    if (!currentGame) {
      socket.emit("games", null);
      return;
    }

    const payload = {
      _id: currentGame.id || currentGame._id,
      status: currentGame.status,
      publicSeed: currentGame.publicSeed,
      privateHash: currentGame.privateHash,
      players: currentGame.players || [],
      history: history || [],
      elapsed:
        currentGame.status === GAME_STATUS.InProgress
          ? Math.max(0, now - startedAtMs)
          : 0,
      payout: currentGame.status === GAME_STATUS.InProgress ? currentPayout : 1,
      timeUntilStart:
        currentGame.status === GAME_STATUS.Starting
          ? Math.max(0, plannedStartAt - now)
          : 0,
    };

    socket.emit("games", payload);
  }

  async function persistGame() {
    try {
      if (!currentGame?.save) return;
      await currentGame.save();
    } catch (e) {
      console.error("[CRASH] persistGame error:", e?.message || e);
    }
  }

  function clearTimers() {
    if (tickTimer) clearInterval(tickTimer);
    if (startTimer) clearTimeout(startTimer);
    tickTimer = null;
    startTimer = null;
  }

  function computePayout(elapsedMs) {
    // exponential curve, rounded to 2 decimals
    const v = Math.exp(GROWTH_RATE * elapsedMs);
    return Math.floor(v * 100) / 100;
  }

  async function createNewRound() {
    const publicSeed = crypto.randomBytes(16).toString("hex");
    const privateSeed = crypto.randomBytes(32).toString("hex");
    const privateHash = sha256Hex(privateSeed);
    const cp = crashPointFromSeeds(publicSeed, privateSeed);

    crashPoint = cp;
    currentPayout = 1.0;

    // Create DB row
    const gameId = crypto.randomBytes(16).toString("hex");
    currentGame = await CrashGame.create({
      _id: gameId,
      status: GAME_STATUS.Starting,
      crashPoint: null, // do NOT reveal before end
      publicSeed,
      privateSeed,      // keep secret until end
      privateHash,
      players: [],
      history: [],      // some schemas store history in this row; we keep runtime history too
      startedAt: null,
      endedAt: null,
    });

    plannedStartAt = Date.now() + STARTING_MS;

    // Tell clients a round is starting
    nsp.emit("game-starting", {
      _id: currentGame.id || currentGame._id,
      timeUntilStart: STARTING_MS,
      publicSeed,
      privateHash,
    });

    // Also broadcast snapshot
    nsp.emit("games", {
      _id: currentGame.id || currentGame._id,
      status: currentGame.status,
      publicSeed,
      privateHash,
      players: currentGame.players || [],
      history,
      timeUntilStart: STARTING_MS,
      elapsed: 0,
      payout: 1,
    });

    await persistGame();

    // schedule start
    startTimer = setTimeout(startRound, STARTING_MS);
  }

  async function startRound() {
    if (!currentGame) return;

    // ✅ Don't start round if no players joined (optional - keeps game waiting)
    const players = currentGame.players || [];
    if (players.length === 0) {
      // restart countdown, don't start multiplier
      plannedStartAt = Date.now() + STARTING_MS;
      nsp.emit("game-starting", {
        _id: currentGame.id || currentGame._id,
        timeUntilStart: STARTING_MS,
        publicSeed: currentGame.publicSeed,
        privateHash: currentGame.privateHash,
      });
      startTimer = setTimeout(startRound, STARTING_MS);
      return;
    }

    currentGame.status = GAME_STATUS.InProgress;
    currentGame.startedAt = new Date();
    startedAtMs = Date.now();
    await persistGame();

    nsp.emit("game-start", {
      publicSeed: currentGame.publicSeed,
      privateHash: currentGame.privateHash,
    });

    // start ticking
    tickTimer = setInterval(async () => {
      try {
        const elapsed = Date.now() - startedAtMs;
        let payout = computePayout(elapsed);

        // auto-cashout (if target reached) BEFORE crash check
        const players = currentGame.players || [];
        for (const p of players) {
          if (p.status === "bet" && p.target && payout >= p.target) {
            // cash out at current payout (or exactly target, your choice)
            const cashMult = payout;
            p.status = "cashedout";
            p.cashoutAt = new Date().toISOString();
            p.stoppedAt = cashMult;
            p.cashoutMultiplier = cashMult;
            // Payouts must be positive integers for on-chain transfer
            p.winAmount = Math.floor(Number(p.betAmount) * cashMult);

            // ✅ Pay out tokens to user
            if (p.winAmount > 0) {
              try {
                console.log(`[CRASH] Auto-cashout: Paying ${p.winAmount} to ${p.publicId}`);
                const payoutResult = await payFromCasinoToUser({ toPublicId: p.publicId, amount: p.winAmount });
                p.payoutTxId = payoutResult.txId;
                console.log(`[CRASH] Auto-cashout: Payout successful, txId: ${p.payoutTxId}`);
              } catch (payoutError) {
                console.error("[CRASH] Auto-cashout payout error:", payoutError);
                // Continue anyway - payout error logged but player still cashed out
                p.payoutError = payoutError.message;
              }
            }

            // Save payoutTxId to database
            await persistGame();

            nsp.emit("bet-cashout", [p]);
            const playerSocket = nsp.sockets.get(p.socketId);
            if (playerSocket) {
              playerSocket.emit("bet-cashout-success", { 
                payoutTxId: p.payoutTxId, 
                winAmount: p.winAmount, 
                multiplier: cashMult 
              });
            }
          }
        }

        // crash condition
        if (payout >= crashPoint) {
          payout = crashPoint;
          currentPayout = payout;

          // final tick
          nsp.emit("game-tick", currentPayout);

          await endRound();
          return;
        }

        currentPayout = payout;
        nsp.emit("game-tick", currentPayout);

        // Update game state in DB periodically (every second)
        if (elapsed % 1000 < TICK_MS) {
          await persistGame();
        }
      } catch (e) {
        console.error("[CRASH] tick error:", e?.message || e);
      }
    }, TICK_MS);
  }

  async function endRound() {
    clearTimers();
    if (!currentGame) return;

    currentGame.status = GAME_STATUS.Over;
    currentGame.endedAt = new Date();

    // reveal crash point now
    currentGame.crashPoint = crashPoint;

    // mark losers
    const players = currentGame.players || [];
    for (const p of players) {
      if (p.status === "bet") {
        p.status = "lost";
        p.lostAt = new Date().toISOString();
      }
    }

    // push history (last N)
    history.unshift({
      _id: currentGame.id || currentGame._id,
      crashPoint,
      publicSeed: currentGame.publicSeed,
      privateHash: currentGame.privateHash,
      endedAt: currentGame.endedAt,
    });
    history = history.slice(0, 30);

    await persistGame();

    // Emit game-end (frontend expects game: { crashPoint, publicSeed, privateSeed, ... })
    nsp.emit("game-end", {
      game: {
        _id: currentGame.id || currentGame._id,
        status: currentGame.status,
        crashPoint,
        publicSeed: currentGame.publicSeed,
        privateSeed: currentGame.privateSeed, // reveal for verification
        privateHash: currentGame.privateHash,
        players: currentGame.players || [],
        endedAt: currentGame.endedAt,
      },
    });

    // short gap then next round
    setTimeout(() => {
      createNewRound().catch((e) => console.error("[CRASH] createNewRound error:", e));
    }, 1000);
  }

  function getSocketWallet(socket) {
    return normalizeWalletId(
      socket.data?.publicId ||
        socket.handshake?.auth?.publicId ||
        socket.handshake?.query?.publicId
    );
  }

  // ---- Socket handlers ----
  nsp.on("connection", (socket) => {
    console.log("[CRASH] Client connected:", socket.id);

    // client can send: socket.emit("auth", { publicId })
    socket.on("auth", (data) => {
      const publicId = normalizeWalletId(data?.publicId || data?.publicKey);
      if (publicId) socket.data.publicId = publicId;
      safeEmitGames(socket);
    });

    socket.on("games", () => {
      safeEmitGames(socket);
    });

    // join-game must include txId (transaction required)
    socket.on("join-game", async (payload) => {
      try {
        if (!currentGame) {
          socket.emit("game-join-error", "No game available yet");
          return;
        }
        if (currentGame.status !== GAME_STATUS.Starting) {
          socket.emit("game-join-error", "Bets are only allowed during Starting phase");
          return;
        }

        // ✅ only accept object payload now
        if (typeof payload !== "object" || !payload) {
          socket.emit("game-join-error", "Invalid payload");
          return;
        }

        let { target, betAmount, currencyId, txId } = payload;

        target = Number(target) / 100; // Target is stored as multiplier * 100 in frontend
        betAmount = Number(betAmount);

        // ✅ Require txId
        if (!txId || typeof txId !== "string") {
          socket.emit("game-join-error", "Missing txId (transaction required)");
          return;
        }

        if (!Number.isFinite(target) || target < 1.01) {
          socket.emit("game-join-error", "Invalid target multiplier");
          return;
        }
        if (!Number.isFinite(betAmount) || betAmount <= 0) {
          socket.emit("game-join-error", "Invalid bet amount");
          return;
        }

        const publicId = getSocketWallet(socket);
        if (!publicId) {
          socket.emit("game-join-error", "Wallet not connected (missing publicId)");
          return;
        }

        // prevent duplicate bet same round
        const players = currentGame.players || [];
        if (players.some((p) => p.publicId === publicId)) {
          socket.emit("game-join-error", "You already joined this round");
          return;
        }

        // ✅ prevent tx replay in same round
        if (players.some((p) => p.txId === txId)) {
          socket.emit("game-join-error", "Transaction already used");
          return;
        }

        // ✅ TODO: Verify Qubic transaction on-chain
        // const txValid = await verifyQubicTransaction({ publicId, betAmount, txId });
        // if (!txValid) {
        //   socket.emit("game-join-error", "Transaction not valid/confirmed for this bet");
        //   return;
        // }
        const player = {
          playerID: crypto.randomBytes(8).toString("hex"),
          socketId: socket.id,
          publicId,
          betAmount,
          target,
          currencyId: currencyId || null,
          txId,
          status: "bet",
          joinedAt: new Date().toISOString(),
        };

        currentGame.players = [...players, player];
        await persistGame();

        socket.emit("game-join-success", player);
        nsp.emit("game-bets", currentGame.players); // frontend expects array

      } catch (e) {
        console.error("[CRASH] join-game error:", e?.message || e);
        socket.emit("game-join-error", "Join failed: " + (e?.message || "Unknown error"));
      }
    });

    socket.on("bet-cashout", async () => {
      try {
        if (!currentGame) {
          socket.emit("bet-cashout-error", "No game available");
          return;
        }
        if (currentGame.status !== GAME_STATUS.InProgress) {
          socket.emit("bet-cashout-error", "Game is not in progress");
          return;
        }

        const publicId = getSocketWallet(socket);
        if (!publicId) {
          socket.emit("bet-cashout-error", "Wallet not connected (missing publicId)");
          return;
        }

        const players = currentGame.players || [];
        const p = players.find((x) => x.publicId === publicId || x.socketId === socket.id);

        if (!p) {
          socket.emit("bet-cashout-error", "You have no active bet in this round");
          return;
        }
        if (p.status !== "bet") {
          socket.emit("bet-cashout-error", "Already cashed out (or already lost)");
          return;
        }

        // if already crashed (shouldn't happen if status is InProgress, but safe)
        if (currentPayout >= crashPoint) {
          socket.emit("bet-cashout-error", "Too late (crashed)");
          return;
        }

        p.status = "cashedout";
        p.cashoutAt = new Date().toISOString();
        p.stoppedAt = currentPayout;
        p.cashoutMultiplier = currentPayout;
        // Payouts must be positive integers for on-chain transfer
        p.winAmount = Math.floor(Number(p.betAmount) * currentPayout);

        // ✅ Pay out tokens to user
        let payoutTxId = null;
        if (p.winAmount > 0) {
          try {
            console.log(`[CRASH] Manual cashout: Paying ${p.winAmount} to ${publicId}`);
            const payoutResult = await payFromCasinoToUser({ toPublicId: publicId, amount: p.winAmount });
            payoutTxId = payoutResult.txId;
            p.payoutTxId = payoutTxId;
            console.log(`[CRASH] Manual cashout: Payout successful, txId: ${payoutTxId}`);
          } catch (payoutError) {
            console.error("[CRASH] Manual cashout payout error:", payoutError);
            // Revert player status if payout fails
            p.status = "bet";
            await persistGame();
            socket.emit("bet-cashout-error", "Payout failed: " + (payoutError?.message || "Unknown error"));
            return;
          }
        }

        await persistGame();

        socket.emit("bet-cashout-success", { payoutTxId, winAmount: p.winAmount, multiplier: currentPayout });
        nsp.emit("bet-cashout", [p]);

      } catch (e) {
        console.error("[CRASH] cashout error:", e?.message || e);
        socket.emit("bet-cashout-error", "Cashout failed: " + (e?.message || "Unknown error"));
      }
    });

    socket.on("disconnect", () => {
      console.log("[CRASH] Client disconnected:", socket.id);
    });

    // On connect, immediately send current state
    safeEmitGames(socket);
  });

  // ---- Boot: start rounds ----
  (async () => {
    try {
      // Load recent game history from DB (optional - history can start empty)
      // Note: CrashGame model doesn't have a find method, so we start with empty history
      // History will be populated as games complete
      
      console.log("[CRASH] Starting crash game namespace...");
      await createNewRound();
    } catch (e) {
      console.error("[CRASH] boot error:", e?.message || e);
      // Retry after delay
      setTimeout(() => {
        (async () => {
          try {
            await createNewRound();
          } catch (err) {
            console.error("[CRASH] retry createNewRound error:", err?.message || err);
          }
        })();
      }, 5000);
    }
  })();

  return nsp;
};
