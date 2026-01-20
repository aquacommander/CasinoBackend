const { query } = require('../database/connection');
const crypto = require('crypto');

const MINE_CELL_COUNT = 25;

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function maskHas(mask, index) {
  return ((mask >>> index) & 1) === 1;
}

function buildMasksFromDatas(datas) {
  let minesMask = 0;
  let revealedMask = 0;
  const list = Array.isArray(datas) ? datas : [];
  for (const item of list) {
    const idx = Number(item?.point);
    if (!Number.isInteger(idx) || idx < 0 || idx >= MINE_CELL_COUNT) continue;
    if (item?.mine === 'BOMB') {
      minesMask |= 1 << idx;
    }
    if (item?.mined) {
      revealedMask |= 1 << idx;
    }
  }
  return { minesMask: minesMask >>> 0, revealedMask: revealedMask >>> 0 };
}

function buildDatasFromMasks(minesMask, revealedMask) {
  const datas = [];
  const mines = Number(minesMask) >>> 0;
  const revealed = Number(revealedMask) >>> 0;
  for (let i = 0; i < MINE_CELL_COUNT; i += 1) {
    datas.push({
      point: i,
      mine: maskHas(mines, i) ? 'BOMB' : 'GEM',
      mined: maskHas(revealed, i),
    });
  }
  return datas;
}

/**
 * Safely parse JSON columns that may come back as:
 * - null/undefined
 * - string (valid JSON, invalid JSON, empty)
 * - object/array (already parsed by mysql2)
 * - Buffer
 */
function safeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;

  // mysql2 can return JSON columns as Buffer sometimes
  if (Buffer.isBuffer(value)) {
    const s = value.toString('utf8').trim();
    if (!s) return fallback;
    try {
      return JSON.parse(s);
    } catch (e) {
      console.warn('⚠️ Invalid JSON (Buffer) in DB column, using fallback:', s.slice(0, 120));
      return fallback;
    }
  }

  // Some setups return JSON columns already parsed
  if (typeof value === 'object') return value;

  // If it's not a string, just return fallback
  if (typeof value !== 'string') return fallback;

  const s = value.trim();
  if (!s) return fallback;

  try {
    return JSON.parse(s);
  } catch (e) {
    console.warn('⚠️ Invalid JSON (string) in DB column, using fallback:', s.slice(0, 120));
    return fallback;
  }
}

/**
 * Crash Game Model (MySQL)
 */
const CrashGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM crash_rounds WHERE 1=1';
    const params = [];

    if (filters._id) {
      sql += ' AND id = ?';
      params.push(filters._id);
    }

    if (filters.status) {
      if (Array.isArray(filters.status.$in)) {
        const placeholders = filters.status.$in.map(() => '?').join(',');
        sql += ` AND status IN (${placeholders})`;
        params.push(...filters.status.$in);
      } else {
        sql += ' AND status = ?';
        params.push(filters.status);
      }
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const results = await query(sql, params);
    if (results.length === 0) return null;

    const game = results[0];
    return {
      _id: game.id,
      status: game.status,
      crashPoint: parseFloat(game.crash_point),
      publicSeed: game.public_seed,
      privateSeed: game.private_seed,
      privateHash: game.private_seed_hash,
      players: [],
      history: [],
      createdAt: game.created_at,
      startedAt: game.started_at,
      endedAt: game.ended_at,
      save: async function () {
        return await CrashGame.findByIdAndUpdate(this._id, this);
      },
    };
  },

  async create(data) {
    const sql = `INSERT INTO crash_rounds 
      (status, crash_point, public_seed, private_seed, private_seed_hash, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const params = [
      data.status || 1,
      data.crashPoint || 0,
      data.publicSeed || null,
      data.privateSeed || null,
      data.privateHash || null,
      data.startedAt || null,
      data.endedAt || null,
    ];

    const result = await query(sql, params);
    return await CrashGame.findOne({ _id: result.insertId });
  },

  async findByIdAndUpdate(id, updates) {
    const setParts = [];
    const params = [];

    if (updates.status !== undefined) {
      setParts.push('status = ?');
      params.push(updates.status);
    }
    if (updates.crashPoint !== undefined) {
      setParts.push('crash_point = ?');
      params.push(updates.crashPoint);
    }
    if (updates.startedAt !== undefined) {
      setParts.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.endedAt !== undefined) {
      setParts.push('ended_at = ?');
      params.push(updates.endedAt);
    }

    if (setParts.length === 0) return await CrashGame.findOne({ _id: id });

    params.push(id);
    const sql = `UPDATE crash_rounds SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await CrashGame.findOne({ _id: id });
  },
};

/**
 * Slide Game Model (MySQL)
 */
const SlideGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM slide_rounds WHERE 1=1';
    const params = [];

    if (filters._id) {
      sql += ' AND id = ?';
      params.push(filters._id);
    }

    if (filters.status) {
      if (Array.isArray(filters.status.$in)) {
        const placeholders = filters.status.$in.map(() => '?').join(',');
        sql += ` AND status IN (${placeholders})`;
        params.push(...filters.status.$in);
      } else {
        sql += ' AND status = ?';
        params.push(filters.status);
      }
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const results = await query(sql, params);
    if (results.length === 0) return null;

    const game = results[0];
    return {
      _id: game.id,
      status: game.status,
      crashPoint: parseFloat(game.crash_point),
      numbers: [],
      publicSeed: game.public_seed,
      privateHash: game.private_seed_hash,
      players: [],
      createdAt: game.created_at,
      save: async function () {
        return await SlideGame.findByIdAndUpdate(this._id, this);
      },
    };
  },

  async create(data) {
    const sql = `INSERT INTO slide_rounds 
      (status, crash_point, public_seed, private_seed_hash, private_seed, numbers_digest)
      VALUES (?, ?, ?, ?, ?, ?)`;

    const numbersDigest = data.numbers
      ? sha256Buffer(JSON.stringify(data.numbers))
      : null;

    const params = [
      data.status || 0,
      data.crashPoint || 0,
      data.publicSeed || null,
      data.privateHash || null,
      data.privateSeed || null,
      numbersDigest,
    ];

    const result = await query(sql, params);
    return await SlideGame.findOne({ _id: result.insertId });
  },

  async findByIdAndUpdate(id, updates) {
    const setParts = [];
    const params = [];

    if (updates.status !== undefined) {
      setParts.push('status = ?');
      params.push(updates.status);
    }
    if (updates.privateSeed !== undefined) {
      setParts.push('private_seed = ?');
      params.push(updates.privateSeed);
    }
    if (updates.numbers !== undefined) {
      setParts.push('numbers_digest = ?');
      params.push(sha256Buffer(JSON.stringify(updates.numbers)));
    }
    if (updates.crashPoint !== undefined) {
      setParts.push('crash_point = ?');
      params.push(updates.crashPoint);
    }

    if (setParts.length === 0) return await SlideGame.findOne({ _id: id });

    params.push(id);
    const sql = `UPDATE slide_rounds SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await SlideGame.findOne({ _id: id });
  },

  async find(filters) {
    let selectFields = '*';
    if (filters.select) {
      selectFields = filters.select;
    }

    let sql = `SELECT ${selectFields} FROM slide_rounds WHERE 1=1`;
    const params = [];

    if (filters.status !== undefined) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const results = await query(sql, params);
    return results.map((game) => ({
      _id: game.id,
      id: game.id,
      crashPoint: game.crash_point ? parseFloat(game.crash_point) : null,
      crash_point: game.crash_point,
      createdAt: game.created_at,
    }));
  },
};

/**
 * Mine Game Model (MySQL)
 */
const MineGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM mine_sessions WHERE 1=1';
    const params = [];

    if (filters.id) {
      sql += ' AND id = ?';
      params.push(filters.id);
    }

    if (filters.publicKey) {
      sql += ' AND wallet_public_key = ?';
      params.push(filters.publicKey);
    }

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.payoutStatus) {
      sql += ' AND payout_status = ?';
      params.push(filters.payoutStatus);
    }

    // Handle MongoDB-style $gt/$lt operators
    if (filters.expiresAt) {
      if (filters.expiresAt.$gt) {
        sql += ' AND expires_at > ?';
        params.push(filters.expiresAt.$gt);
      } else if (filters.expiresAt.$lt) {
        sql += ' AND expires_at < ?';
        params.push(filters.expiresAt.$lt);
      } else {
        sql += ' AND expires_at > ?';
        params.push(filters.expiresAt);
      }
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const results = await query(sql, params);
    if (results.length === 0) return null;

    const game = results[0];
    const minesMask = Number(game.mines_mask) >>> 0;
    const revealedMask = Number(game.revealed_mask) >>> 0;
    return {
      id: game.id,
      publicKey: game.wallet_public_key,
      status: game.status,
      mines: game.mines_count,
      amount: game.bet_amount,
      datas: buildDatasFromMasks(minesMask, revealedMask),
      txId: game.bet_tx_id || null,
      publicSeed: game.public_seed || null,
      privateSeedHash: game.private_seed_hash || null,
      privateSeed: game.private_seed || null,
      minesMask,
      revealedMask,
      createdAt: game.created_at,
      expiresAt: game.expires_at,
      // Payout fields
      payoutAmount: game.payout_amount || null,
      payoutTxId: game.payout_tx_id || null,
      payoutStatus: game.payout_status || 'NONE',
      payoutError: game.payout_error || null,
      save: async function () {
        return await MineGame.findByIdAndUpdate(this.id, this);
      },
    };
  },

  async create(data) {
    // Convert all values to primitives explicitly
    const publicKey = String(data.publicKey ?? '');
    const status = String(data.status ?? 'READY');
    const minesCount = Number.parseInt(String(data.mines ?? '0'), 10);
    const amount = Number.parseInt(String(data.amount ?? '0'), 10);
    const txId = data.txId ? String(data.txId) : null;
    const { minesMask, revealedMask } = buildMasksFromDatas(data.datas || []);
    const publicSeed = data.publicSeed || null;
    const privateSeedHash = data.privateSeedHash || null;
    const privateSeed = data.privateSeed || null;

    // Let mysql2 handle Date objects directly
    const expiresAt =
      data.expiresAt instanceof Date
        ? data.expiresAt
        : data.expiresAt
        ? new Date(data.expiresAt)
        : null;

    // Validate required fields
    if (!publicKey || publicKey.trim() === '') {
      throw new Error('publicKey is required');
    }
    if (!Number.isInteger(minesCount) || minesCount <= 0) {
      throw new Error('mines must be a positive integer');
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('amount must be a positive integer');
    }

    const sql = `INSERT INTO mine_sessions 
      (wallet_public_key, status, mines_count, bet_amount, bet_tx_id, public_seed, private_seed_hash, private_seed, mines_mask, revealed_mask, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
      publicKey,
      status,
      minesCount,
      amount,
      txId,
      publicSeed,
      privateSeedHash,
      privateSeed,
      minesMask,
      revealedMask,
      expiresAt,
    ];

    // Validate no undefined or NaN in params
    if (params.some((v) => v === undefined || (typeof v === 'number' && Number.isNaN(v)))) {
      console.error('Invalid params:', params.map((v, i) => [i, typeof v, v]));
      throw new Error('Invalid request payload (undefined/NaN in params)');
    }

    // Log for debugging
    console.log('MineGame.create SQL:', sql);
    console.log(
      'MineGame.create PARAMS:',
      params.map((v) => [typeof v, v])
    );
    console.log('MineGame.create placeholders:', (sql.match(/\?/g) ?? []).length, 'values:', params.length);

    const result = await query(sql, params);

    const insertId = result.insertId;
    if (!insertId) {
      throw new Error('Failed to get insert ID from database');
    }

    const findSql = 'SELECT * FROM mine_sessions WHERE id = ? LIMIT 1';
    const findResults = await query(findSql, [insertId]);
    if (findResults.length === 0) {
      throw new Error('Failed to retrieve created game');
    }

    const game = findResults[0];
    const storedMinesMask = Number(game.mines_mask) >>> 0;
    const storedRevealedMask = Number(game.revealed_mask) >>> 0;
    return {
      id: game.id,
      publicKey: game.wallet_public_key,
      status: game.status,
      mines: game.mines_count,
      amount: game.bet_amount,
      datas: buildDatasFromMasks(storedMinesMask, storedRevealedMask),
      txId: game.bet_tx_id || null,
      createdAt: game.created_at,
      expiresAt: game.expires_at,
      save: async function () {
        return await MineGame.findByIdAndUpdate(this.id, this);
      },
    };
  },

  async findByIdAndUpdate(id, updates) {
    const setParts = [];
    const params = [];

    if (updates.status !== undefined) {
      setParts.push('status = ?');
      params.push(updates.status);
    }
    if (updates.datas !== undefined) {
      const { revealedMask } = buildMasksFromDatas(updates.datas);
      setParts.push('revealed_mask = ?');
      params.push(revealedMask);
    }
    if (updates.revealedMask !== undefined) {
      setParts.push('revealed_mask = ?');
      params.push(Number(updates.revealedMask) >>> 0);
    }
    if (updates.expiresAt !== undefined) {
      setParts.push('expires_at = ?');
      params.push(updates.expiresAt);
    }

    // Payout fields
    if (updates.payoutAmount !== undefined) {
      setParts.push('payout_amount = ?');
      params.push(Number(updates.payoutAmount));
    }
    if (updates.payoutTxId !== undefined) {
      setParts.push('payout_tx_id = ?');
      params.push(updates.payoutTxId ? String(updates.payoutTxId) : null);
    }
    if (updates.payoutStatus !== undefined) {
      setParts.push('payout_status = ?');
      params.push(String(updates.payoutStatus));
    }
    if (updates.payoutError !== undefined) {
      setParts.push('payout_error = ?');
      params.push(updates.payoutError ? String(updates.payoutError) : null);
    }

    if (setParts.length === 0) return await MineGame.findOne({ id });

    params.push(id);
    const sql = `UPDATE mine_sessions SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await MineGame.findOne({ id });
  },

  async deleteExpiredLiveGames(publicKey) {
    const sql = `
      UPDATE mine_sessions
      SET status = 'EXPIRED'
      WHERE wallet_public_key = ?
        AND status = 'LIVE'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
    `;
    return await query(sql, [String(publicKey)]);
  },

  async deleteMany(filters) {
    let sql = 'DELETE FROM mine_sessions WHERE 1=1';
    const params = [];

    if (filters.publicKey) {
      sql += ' AND wallet_public_key = ?';
      params.push(filters.publicKey);
    }

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.expiresAt) {
      sql += ' AND expires_at < ?';
      params.push(filters.expiresAt);
    }

    await query(sql, params);
  },
};

/**
 * Video Poker Game Model (MySQL)
 */
const VideoPokerGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM video_poker_sessions WHERE 1=1';
    const params = [];

    if (filters.publicKey) {
      sql += ' AND wallet_public_key = ?';
      params.push(filters.publicKey);
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const results = await query(sql, params);
    if (results.length === 0) return null;

    const game = results[0];
    return {
      id: game.id,
      publicKey: game.wallet_public_key,
      publicSeed: game.public_seed,
      privateSeed: game.private_seed,
      privateSeedHash: game.private_seed_hash,
      hand: game.initial_hand ? Array.from(game.initial_hand) : [],
      holdMask: game.hold_mask ?? null,
      finalHand: game.final_hand ? Array.from(game.final_hand) : null,
      betAmount: game.bet_amount,
      result: game.result,
      payout: game.payout_amount,
      createdAt: game.created_at,
      save: async function () {
        return await VideoPokerGame.findByIdAndUpdate(this.id, this);
      },
    };
  },

  async create(data) {
    const sql = `INSERT INTO video_poker_sessions 
      (wallet_public_key, public_seed, private_seed, private_seed_hash, initial_hand, bet_amount, result, payout_amount, bet_tx_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const initialHand =
      data.hand instanceof Buffer
        ? data.hand
        : Array.isArray(data.hand)
        ? Buffer.from(data.hand.map((v) => Number(v)))
        : null;

    const params = [
      data.publicKey,
      data.publicSeed || null,
      data.privateSeed || null,
      data.privateSeedHash || null,
      initialHand,
      data.betAmount || 0,
      data.result || '',
      data.payout || 0,
      data.betTxId || null,
      data.status || 'LIVE',
    ];

    const result = await query(sql, params);
    return await VideoPokerGame.findOne({ id: result.insertId });
  },

  async findByIdAndUpdate(id, updates) {
    const setParts = [];
    const params = [];

    if (updates.hand !== undefined) {
      const finalHand =
        updates.hand instanceof Buffer
          ? updates.hand
          : Array.isArray(updates.hand)
          ? Buffer.from(updates.hand.map((v) => Number(v)))
          : null;
      setParts.push('final_hand = ?');
      params.push(finalHand);
    }
    if (updates.holdMask !== undefined) {
      setParts.push('hold_mask = ?');
      params.push(updates.holdMask);
    }
    if (updates.result !== undefined) {
      setParts.push('result = ?');
      params.push(updates.result);
    }
    if (updates.payout !== undefined) {
      setParts.push('payout_amount = ?');
      params.push(updates.payout);
    }

    if (setParts.length === 0) return await VideoPokerGame.findOne({ id });

    params.push(id);
    const sql = `UPDATE video_poker_sessions SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await VideoPokerGame.findOne({ id });
  },
};

module.exports = {
  CrashGame,
  SlideGame,
  MineGame,
  VideoPokerGame,
};
