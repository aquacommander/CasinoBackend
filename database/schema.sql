-- QUBIC Casino Database Schema
-- Run this SQL script to create all required tables

CREATE DATABASE IF NOT EXISTS qubic_casino CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE qubic_casino;

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_key VARCHAR(80) UNIQUE NOT NULL,
  qubic_balance BIGINT NOT NULL DEFAULT 0,
  qdoge_balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_public_key (public_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Crash games table
CREATE TABLE IF NOT EXISTS crash_games (
  id VARCHAR(32) PRIMARY KEY,
  status INT NOT NULL DEFAULT 1,
  crash_point DECIMAL(10, 2) DEFAULT 0,
  public_seed VARCHAR(64),
  private_seed VARCHAR(64),
  private_hash VARCHAR(64),
  players JSON,
  history JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Slide games table
CREATE TABLE IF NOT EXISTS slide_games (
  id VARCHAR(32) PRIMARY KEY,
  status INT NOT NULL DEFAULT 0,
  crash_point DECIMAL(10, 2) DEFAULT 0,
  numbers JSON,
  public_seed VARCHAR(64),
  private_hash VARCHAR(64),
  players JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mine games table
CREATE TABLE IF NOT EXISTS mine_games (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_key VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'READY',
  mines INT NOT NULL,
  amount BIGINT NOT NULL,
  datas JSON,
  tx_id VARCHAR(128) NULL,
  payout_amount BIGINT NULL DEFAULT NULL,
  payout_tx_id VARCHAR(128) NULL DEFAULT NULL,
  payout_status VARCHAR(20) NOT NULL DEFAULT 'NONE',
  multiplier DECIMAL(10, 4) NULL DEFAULT NULL,
  revealed_gems INT NULL DEFAULT NULL,
  house_edge DECIMAL(5, 4) NULL DEFAULT NULL,
  payout_error TEXT NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  INDEX idx_public_key (public_key),
  INDEX idx_status (status),
  INDEX idx_expires_at (expires_at),
  INDEX idx_tx_id (tx_id),
  INDEX idx_payout_status (payout_status),
  INDEX idx_payout_tx_id (payout_tx_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Video poker games table (Mines-style schema)
CREATE TABLE IF NOT EXISTS video_poker_games (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_key VARCHAR(80) NOT NULL,

  status VARCHAR(10) NOT NULL DEFAULT 'LIVE',
  expires_at DATETIME NULL,

  public_seed VARCHAR(80) NOT NULL,
  private_seed VARCHAR(80) NOT NULL,
  private_seed_hash VARCHAR(80) NOT NULL,

  hand JSON NOT NULL,
  hold_indexes JSON NULL,

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
  INDEX idx_public_key_status_created (public_key, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users table (wallet-based registration)
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_id VARCHAR(80) NOT NULL,
  status ENUM('active','banned') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_wallet (wallet_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bets table (tracks all games: who bet what, where, and payout)
CREATE TABLE IF NOT EXISTS bets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_id VARCHAR(80) NOT NULL,

  game VARCHAR(32) NOT NULL,          -- 'slide', 'crash', 'mine', 'videopoker'
  round_id VARCHAR(64) NOT NULL,      -- game round _id (string)

  bet_amount BIGINT NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'QU',
  target INT NULL,                    -- slide/crash target
  bet_tx_id VARCHAR(128) NOT NULL,    -- tx sent to casino

  outcome ENUM('pending','won','lost') NOT NULL DEFAULT 'pending',
  payout_amount BIGINT NOT NULL DEFAULT 0,
  payout_tx_id VARCHAR(128) NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMP NULL DEFAULT NULL,

  PRIMARY KEY (id),
  KEY idx_bets_user (user_id),
  KEY idx_bets_wallet (wallet_id),
  KEY idx_bets_game_round (game, round_id),
  UNIQUE KEY uq_bets_bet_tx (bet_tx_id),

  CONSTRAINT fk_bets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
