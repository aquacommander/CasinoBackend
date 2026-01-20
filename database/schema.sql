CREATE DATABASE IF NOT EXISTS qubic_casino
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qubic_casino;

-- Wallets == users (merge to avoid duplication)
CREATE TABLE IF NOT EXISTS wallets (
  public_key VARCHAR(80) PRIMARY KEY,
  status ENUM('active','banned') NOT NULL DEFAULT 'active',
  qubic_balance BIGINT NOT NULL DEFAULT 0,
  qdoge_balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Round tables: store ONLY provably-fair + final outcome (no players/history JSON)
CREATE TABLE IF NOT EXISTS crash_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1, -- 1 waiting, 2 betting, 3 playing, 4 ended
  crash_point DECIMAL(10,2) NOT NULL DEFAULT 0,

  public_seed CHAR(64) NOT NULL,
  private_seed_hash CHAR(64) NOT NULL,
  private_seed CHAR(64) NULL, -- reveal after ended (optional)

  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_status_created (status, created_at),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS slide_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  crash_point DECIMAL(10,2) NOT NULL DEFAULT 0,

  public_seed CHAR(64) NOT NULL,
  private_seed_hash CHAR(64) NOT NULL,
  private_seed CHAR(64) NULL, -- reveal after ended (optional)

  -- Optional: store a short digest of generated numbers for audit/debug
  numbers_digest BINARY(32) NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_status_created (status, created_at),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB;

-- One bets table for all games (authoritative player-level record)
CREATE TABLE IF NOT EXISTS bets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  wallet_public_key VARCHAR(80) NOT NULL,
  game ENUM('crash','slide','mine','videopoker') NOT NULL,

  -- Use BIGINT round/session id for crash/slide; for mines/vp you can store their session id here too
  round_id BIGINT UNSIGNED NOT NULL,

  bet_amount BIGINT NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'QU',
  target INT NULL,
  bet_tx_id VARCHAR(128) NOT NULL,

  outcome ENUM('pending','won','lost') NOT NULL DEFAULT 'pending',
  payout_amount BIGINT NOT NULL DEFAULT 0,
  payout_tx_id VARCHAR(128) NULL,
  settled_at TIMESTAMP NULL DEFAULT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_bet_tx (bet_tx_id),
  KEY idx_game_round (game, round_id),
  KEY idx_wallet_created (wallet_public_key, created_at),
  KEY idx_outcome_created (outcome, created_at),
  KEY idx_payout_tx (payout_tx_id),

  CONSTRAINT fk_bets_wallet
    FOREIGN KEY (wallet_public_key) REFERENCES wallets(public_key)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Mines: use bitmasks instead of JSON (25 cells fits in 32 bits)
-- mines_mask: which cells are mines
-- revealed_mask: which cells revealed
CREATE TABLE IF NOT EXISTS mine_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_public_key VARCHAR(80) NOT NULL,

  status ENUM('READY','LIVE','ENDED','EXPIRED') NOT NULL DEFAULT 'READY',
  mines_count TINYINT UNSIGNED NOT NULL,
  bet_amount BIGINT NOT NULL,
  bet_tx_id VARCHAR(128) NULL,

  public_seed CHAR(64) NOT NULL,
  private_seed_hash CHAR(64) NOT NULL,
  private_seed CHAR(64) NULL,

  mines_mask INT UNSIGNED NOT NULL DEFAULT 0,
  revealed_mask INT UNSIGNED NOT NULL DEFAULT 0,

  payout_amount BIGINT NULL,
  payout_tx_id VARCHAR(128) NULL,
  payout_status ENUM('NONE','PENDING','SENT','FAILED') NOT NULL DEFAULT 'NONE',
  payout_error TEXT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_mine_bet_tx (bet_tx_id),
  KEY idx_wallet_status_created (wallet_public_key, status, created_at),
  KEY idx_expires_at (expires_at),

  CONSTRAINT fk_mines_wallet
    FOREIGN KEY (wallet_public_key) REFERENCES wallets(public_key)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Optional: store each reveal action (small rows, no JSON)
CREATE TABLE IF NOT EXISTS mine_moves (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  cell TINYINT UNSIGNED NOT NULL,      -- 0..24
  hit_mine BOOLEAN NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session (session_id),
  CONSTRAINT fk_moves_session
    FOREIGN KEY (session_id) REFERENCES mine_sessions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- Video poker: store hands compactly (5 cards, each 0..51)
-- hold_mask: 5-bit bitmask (bit0 for card0, etc.)
CREATE TABLE IF NOT EXISTS video_poker_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_public_key VARCHAR(80) NOT NULL,

  status ENUM('LIVE','ENDED','EXPIRED') NOT NULL DEFAULT 'LIVE',
  expires_at TIMESTAMP NULL,

  public_seed CHAR(64) NOT NULL,
  private_seed_hash CHAR(64) NOT NULL,
  private_seed CHAR(64) NULL,

  initial_hand VARBINARY(5) NOT NULL,
  hold_mask TINYINT UNSIGNED NULL,
  final_hand VARBINARY(5) NULL,

  bet_amount BIGINT NOT NULL,
  bet_tx_id VARCHAR(128) NULL,

  result VARCHAR(50) NULL,
  multiplier INT NULL,
  payout_amount BIGINT NULL,
  profit BIGINT NULL,
  payout_tx_id VARCHAR(128) NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_vp_bet_tx (bet_tx_id),
  KEY idx_wallet_status_created (wallet_public_key, status, created_at),

  CONSTRAINT fk_vp_wallet
    FOREIGN KEY (wallet_public_key) REFERENCES wallets(public_key)
    ON DELETE RESTRICT
) ENGINE=InnoDB;
