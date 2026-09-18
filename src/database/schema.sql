CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tracks which users.id is the currently connected Telegram account.
-- Separate from `users` (a permanent historical record) so logging out
-- doesn't lose a user's data, and logging the same account back in later
-- resumes with the same id. NULL current_user_id means logged out.
CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_user_id INTEGER REFERENCES users(id)
);
INSERT OR IGNORE INTO app_state (id, current_user_id) VALUES (1, NULL);

CREATE TABLE IF NOT EXISTS selected_nfts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  nft_identifier TEXT NOT NULL,
  nft_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
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
