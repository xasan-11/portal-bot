-- One row per Telegram user of the bot (telegram_user_id = the id verified
-- from Telegram, not the account they log in with). Every data table below
-- is scoped to users.id.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Who may use the bot / mini app. The admin (ADMIN_TELEGRAM_ID) is always
-- approved implicitly and needs no row here.
CREATE TABLE IF NOT EXISTS approved_users (
  telegram_user_id INTEGER PRIMARY KEY,
  added_by INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS selected_nfts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  nft_identifier TEXT NOT NULL,
  nft_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Whether the initial no-offer warm-up scan has completed for this
  -- collection (see src/automation/monitor.ts) — without this, every gift
  -- already resale-listed before we ever looked would be mistaken for a
  -- brand-new discovery on the very first scan.
  baselined INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, nft_identifier)
);

CREATE TABLE IF NOT EXISTS nfts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  nft_identifier TEXT NOT NULL,
  nft_name TEXT NOT NULL,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'found',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE (user_id, nft_identifier)
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  nft_identifier TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  telegram_offer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_user_nft_status ON offers (user_id, nft_identifier, status);
CREATE INDEX IF NOT EXISTS idx_offers_user_owner ON offers (user_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_nfts_user_identifier ON nfts (user_id, nft_identifier);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
