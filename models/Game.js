const { query } = require('../database/connection');

/**
 * Crash Game Model (MySQL)
 */
const CrashGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM crash_games WHERE 1=1';
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
      privateHash: game.private_hash,
      players: game.players ? JSON.parse(game.players) : [],
      history: game.history ? JSON.parse(game.history) : [],
      createdAt: game.created_at,
      startedAt: game.started_at,
      endedAt: game.ended_at,
      save: async function() {
        return await CrashGame.findByIdAndUpdate(this._id, this);
      }
    };
  },

  async create(data) {
    const sql = `INSERT INTO crash_games 
      (id, status, crash_point, public_seed, private_seed, private_hash, players, history, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const params = [
      data._id,
      data.status || 1,
      data.crashPoint || 0,
      data.publicSeed || null,
      data.privateSeed || null,
      data.privateHash || null,
      JSON.stringify(data.players || []),
      JSON.stringify(data.history || []),
      data.startedAt || null,
      data.endedAt || null
    ];

    await query(sql, params);
    return await CrashGame.findOne({ _id: data._id });
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
    if (updates.players !== undefined) {
      setParts.push('players = ?');
      params.push(JSON.stringify(updates.players));
    }
    if (updates.history !== undefined) {
      setParts.push('history = ?');
      params.push(JSON.stringify(updates.history));
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
    const sql = `UPDATE crash_games SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await CrashGame.findOne({ _id: id });
  }
};

/**
 * Slide Game Model (MySQL)
 */
const SlideGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM slide_games WHERE 1=1';
    const params = [];

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
      numbers: game.numbers ? JSON.parse(game.numbers) : [],
      publicSeed: game.public_seed,
      privateHash: game.private_hash,
      players: game.players ? JSON.parse(game.players) : [],
      createdAt: game.created_at,
      save: async function() {
        return await SlideGame.findByIdAndUpdate(this._id, this);
      }
    };
  },

  async create(data) {
    const sql = `INSERT INTO slide_games 
      (id, status, crash_point, numbers, public_seed, private_hash, players)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    const params = [
      data._id,
      data.status || 0,
      data.crashPoint || 0,
      JSON.stringify(data.numbers || []),
      data.publicSeed || null,
      data.privateHash || null,
      JSON.stringify(data.players || [])
    ];

    await query(sql, params);
    return await SlideGame.findOne({ _id: data._id });
  },

  async findByIdAndUpdate(id, updates) {
    const setParts = [];
    const params = [];

    if (updates.status !== undefined) {
      setParts.push('status = ?');
      params.push(updates.status);
    }
    if (updates.players !== undefined) {
      setParts.push('players = ?');
      params.push(JSON.stringify(updates.players));
    }
    if (updates.numbers !== undefined) {
      setParts.push('numbers = ?');
      params.push(JSON.stringify(updates.numbers));
    }
    if (updates.crashPoint !== undefined) {
      setParts.push('crash_point = ?');
      params.push(updates.crashPoint);
    }

    if (setParts.length === 0) return await SlideGame.findOne({ _id: id });

    params.push(id);
    const sql = `UPDATE slide_games SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await SlideGame.findOne({ _id: id });
  },

  async find(filters) {
    let selectFields = '*';
    if (filters.select) {
      selectFields = filters.select;
    }

    let sql = `SELECT ${selectFields} FROM slide_games WHERE 1=1`;
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC';
    
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const results = await query(sql, params);
    return results.map(game => ({
      _id: game.id,
      id: game.id,
      crashPoint: game.crash_point ? parseFloat(game.crash_point) : null,
      crash_point: game.crash_point,
      createdAt: game.created_at
    }));
  }
};

/**
 * Mine Game Model (MySQL)
 */
const MineGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM mine_games WHERE 1=1';
    const params = [];

    if (filters.id) {
      sql += ' AND id = ?';
      params.push(filters.id);
    }

    if (filters.publicKey) {
      sql += ' AND public_key = ?';
      params.push(filters.publicKey);
    }

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    // Handle MongoDB-style $gt operator
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
    return {
      id: game.id,
      publicKey: game.public_key,
      status: game.status,
      mines: game.mines,
      amount: game.amount,
      datas: game.datas ? JSON.parse(game.datas) : [],
      txId: game.tx_id || null,
      createdAt: game.created_at,
      expiresAt: game.expires_at,
      // Payout fields
      payoutAmount: game.payout_amount || null,
      payoutTxId: game.payout_tx_id || null,
      payoutStatus: game.payout_status || 'NONE',
      multiplier: game.multiplier ? parseFloat(game.multiplier) : null,
      revealedGems: game.revealed_gems || null,
      houseEdge: game.house_edge ? parseFloat(game.house_edge) : null,
      payoutError: game.payout_error || null,
      save: async function() {
        return await MineGame.findByIdAndUpdate(this.id, this);
      }
    };
  },

  async create(data) {
    // Convert all values to primitives explicitly
    const publicKey = String(data.publicKey ?? '');
    const status = String(data.status ?? 'READY');
    const mines = Number.parseInt(String(data.mines ?? '0'), 10);
    const amount = Number.parseInt(String(data.amount ?? '0'), 10);
    const datasJson = JSON.stringify(data.datas || []);
    const txId = data.txId ? String(data.txId) : null;
    // Let mysql2 handle Date objects directly (no manual conversion needed)
    const expiresAt = data.expiresAt instanceof Date
      ? data.expiresAt
      : data.expiresAt
        ? new Date(data.expiresAt)
        : null;

    // Validate required fields
    if (!publicKey || publicKey.trim() === '') {
      throw new Error('publicKey is required');
    }
    if (!Number.isInteger(mines) || mines <= 0) {
      throw new Error('mines must be a positive integer');
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('amount must be a positive integer');
    }

    const sql = `INSERT INTO mine_games 
      (public_key, status, mines, amount, datas, tx_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    const params = [
      publicKey,
      status,
      mines,
      amount,
      datasJson,
      txId,
      expiresAt
    ];

    // Validate no undefined or NaN in params
    if (params.some((v) => v === undefined || (typeof v === 'number' && Number.isNaN(v)))) {
      console.error('Invalid params:', params.map((v, i) => [i, typeof v, v]));
      throw new Error('Invalid request payload (undefined/NaN in params)');
    }

    // Log for debugging
    console.log('MineGame.create SQL:', sql);
    console.log('MineGame.create PARAMS:', params.map((v) => [typeof v, v]));
    console.log('MineGame.create placeholders:', (sql.match(/\?/g) ?? []).length, 'values:', params.length);

    const result = await query(sql, params);
    
    // Get the inserted ID from the result (OkPacket from mysql2)
    const insertId = result.insertId;
    if (!insertId) {
      throw new Error('Failed to get insert ID from database');
    }
    
    // Query the created game directly by ID
    const findSql = 'SELECT * FROM mine_games WHERE id = ? LIMIT 1';
    const findResults = await query(findSql, [insertId]);
    if (findResults.length === 0) {
      throw new Error('Failed to retrieve created game');
    }
    
    const game = findResults[0];
    return {
      id: game.id,
      publicKey: game.public_key,
      status: game.status,
      mines: game.mines,
      amount: game.amount,
      datas: game.datas ? (typeof game.datas === 'string' ? JSON.parse(game.datas) : game.datas) : [],
      txId: game.tx_id || null,
      createdAt: game.created_at,
      expiresAt: game.expires_at,
      save: async function() {
        return await MineGame.findByIdAndUpdate(this.id, this);
      }
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
      setParts.push('datas = ?');
      params.push(JSON.stringify(updates.datas));
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
    if (updates.multiplier !== undefined) {
      setParts.push('multiplier = ?');
      params.push(updates.multiplier ? Number(updates.multiplier) : null);
    }
    if (updates.revealedGems !== undefined) {
      setParts.push('revealed_gems = ?');
      params.push(updates.revealedGems ? Number(updates.revealedGems) : null);
    }
    if (updates.houseEdge !== undefined) {
      setParts.push('house_edge = ?');
      params.push(updates.houseEdge ? Number(updates.houseEdge) : null);
    }
    if (updates.payoutError !== undefined) {
      setParts.push('payout_error = ?');
      params.push(updates.payoutError ? String(updates.payoutError) : null);
    }

    if (setParts.length === 0) return await MineGame.findOne({ id });

    params.push(id);
    const sql = `UPDATE mine_games SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await MineGame.findOne({ id });
  },

  async deleteExpiredLiveGames(publicKey) {
    const sql = `
      DELETE FROM mine_games
      WHERE public_key = ?
        AND status = 'LIVE'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
    `;
    const result = await query(sql, [String(publicKey)]);
    return result; // ResultSetHeader (affectedRows etc.)
  },

  async deleteMany(filters) {
    let sql = 'DELETE FROM mine_games WHERE 1=1';
    const params = [];

    if (filters.publicKey) {
      sql += ' AND public_key = ?';
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
  }
};

/**
 * Video Poker Game Model (MySQL)
 */
const VideoPokerGame = {
  async findOne(filters) {
    let sql = 'SELECT * FROM video_poker_games WHERE 1=1';
    const params = [];

    if (filters.publicKey) {
      sql += ' AND public_key = ?';
      params.push(filters.publicKey);
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const results = await query(sql, params);
    if (results.length === 0) return null;

    const game = results[0];
    return {
      id: game.id,
      publicKey: game.public_key,
      publicSeed: game.public_seed,
      privateSeed: game.private_seed,
      privateSeedHash: game.private_seed_hash,
      hand: game.hand ? JSON.parse(game.hand) : [],
      betAmount: game.bet_amount,
      result: game.result,
      payout: game.payout,
      createdAt: game.created_at,
      save: async function() {
        return await VideoPokerGame.findByIdAndUpdate(this.id, this);
      }
    };
  },

  async create(data) {
    const sql = `INSERT INTO video_poker_games 
      (public_key, public_seed, private_seed, private_seed_hash, hand, bet_amount, result, payout)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const params = [
      data.publicKey,
      data.publicSeed || null,
      data.privateSeed || null,
      data.privateSeedHash || null,
      JSON.stringify(data.hand || []),
      data.betAmount || 0,
      data.result || '',
      data.payout || 0
    ];

    const result = await query(sql, params);
    return await VideoPokerGame.findOne({ id: result.insertId });
  },

  async findByIdAndUpdate(id, updates) {
    const setParts = [];
    const params = [];

    if (updates.hand !== undefined) {
      setParts.push('hand = ?');
      params.push(JSON.stringify(updates.hand));
    }
    if (updates.result !== undefined) {
      setParts.push('result = ?');
      params.push(updates.result);
    }
    if (updates.payout !== undefined) {
      setParts.push('payout = ?');
      params.push(updates.payout);
    }

    if (setParts.length === 0) return await VideoPokerGame.findOne({ id });

    params.push(id);
    const sql = `UPDATE video_poker_games SET ${setParts.join(', ')} WHERE id = ?`;
    await query(sql, params);
    return await VideoPokerGame.findOne({ id });
  }
};

module.exports = {
  CrashGame,
  SlideGame,
  MineGame,
  VideoPokerGame
};
