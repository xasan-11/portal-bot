import type Database from "better-sqlite3";

/**
 * One-time upgrade for databases created before per-account data scoping
 * existed. Pre-existing `nfts` / `offers` / `selected_nfts` / `settings`
 * rows have no way to know which Telegram account they came from — they are
 * deliberately NOT attributed to whichever account happens to be currently
 * connected when this runs, since that would just recreate a narrower
 * version of the same cross-account leak this migration exists to fix.
 * Instead they're moved into a synthetic "legacy" account bucket: preserved
 * (not deleted — some of this is real offer history), inspectable directly
 * in the database, but never shown by any per-account-scoped query.
 *
 * Safe to run on every startup: it only acts if it finds the old
 * (pre-`user_id`) table shape, and does nothing on an already-migrated or
 * brand-new database.
 */
const LEGACY_TELEGRAM_USER_ID = "__legacy__";

export function migrateLegacySchema(db: Database.Database): void {
  const tableNames = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name
    )
  );

  const hasUserIdColumn = (table: string): boolean => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some((c) => c.name === "user_id");
  };

  const legacyTables = ["nfts", "offers", "selected_nfts", "settings"].filter(
    (t) => tableNames.has(t) && !hasUserIdColumn(t)
  );

  if (legacyTables.length === 0) return; // already migrated, or a fresh database

  console.log("[migrate] upgrading database to per-account data scoping:", legacyTables.join(", "));

  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id TEXT NOT NULL UNIQUE,
        username TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.prepare(`INSERT OR IGNORE INTO users (telegram_user_id, username) VALUES (?, ?)`).run(
      LEGACY_TELEGRAM_USER_ID,
      "Legacy data (pre-account-scoping)"
    );
    const legacyId = (
      db.prepare(`SELECT id FROM users WHERE telegram_user_id = ?`).get(LEGACY_TELEGRAM_USER_ID) as {
        id: number;
      }
    ).id;

    if (legacyTables.includes("nfts")) {
      db.exec(`ALTER TABLE nfts RENAME TO nfts_pre_migration;`);
      db.exec(`
        CREATE TABLE nfts (
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
      `);
      const count = db
        .prepare(
          `INSERT INTO nfts (user_id, nft_identifier, nft_name, owner_id, status, first_seen_at, processed_at)
           SELECT ?, nft_identifier, nft_name, owner_id, status, first_seen_at, processed_at FROM nfts_pre_migration`
        )
        .run(legacyId).changes;
      db.exec(`DROP TABLE nfts_pre_migration;`);
      console.log(`[migrate] nfts: ${count} row(s) moved to legacy bucket (user_id=${legacyId})`);
    }

    if (legacyTables.includes("offers")) {
      db.exec(`ALTER TABLE offers RENAME TO offers_pre_migration;`);
      db.exec(`
        CREATE TABLE offers (
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
      `);
      const count = db
        .prepare(
          `INSERT INTO offers (user_id, nft_identifier, owner_id, stars, duration, telegram_offer_id, status, created_at, updated_at)
           SELECT ?, nft_identifier, owner_id, stars, duration, telegram_offer_id, status, created_at, updated_at FROM offers_pre_migration`
        )
        .run(legacyId).changes;
      db.exec(`DROP TABLE offers_pre_migration;`);
      console.log(`[migrate] offers: ${count} row(s) moved to legacy bucket (user_id=${legacyId})`);
    }

    if (legacyTables.includes("selected_nfts")) {
      db.exec(`ALTER TABLE selected_nfts RENAME TO selected_nfts_pre_migration;`);
      db.exec(`
        CREATE TABLE selected_nfts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          nft_identifier TEXT NOT NULL,
          nft_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, nft_identifier)
        );
      `);
      const count = db
        .prepare(
          `INSERT INTO selected_nfts (user_id, nft_identifier, nft_name, enabled, created_at)
           SELECT ?, nft_identifier, nft_name, enabled, created_at FROM selected_nfts_pre_migration`
        )
        .run(legacyId).changes;
      db.exec(`DROP TABLE selected_nfts_pre_migration;`);
      console.log(`[migrate] selected_nfts: ${count} row(s) moved to legacy bucket (user_id=${legacyId})`);
    }

    if (legacyTables.includes("settings")) {
      db.exec(`ALTER TABLE settings RENAME TO settings_pre_migration;`);
      db.exec(`
        CREATE TABLE settings (
          user_id INTEGER NOT NULL REFERENCES users(id),
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (user_id, key)
        );
      `);
      const count = db
        .prepare(
          `INSERT INTO settings (user_id, key, value) SELECT ?, key, value FROM settings_pre_migration`
        )
        .run(legacyId).changes;
      db.exec(`DROP TABLE settings_pre_migration;`);
      console.log(`[migrate] settings: ${count} row(s) moved to legacy bucket (user_id=${legacyId}) — this account now starts with default settings`);
    }

    // Point "current user" at whichever real (non-legacy) account already
    // has a valid session, if any. This reflects objective reality (that
    // account IS already connected) — it is not an assumption about who
    // the pre-migration business data above belongs to.
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_user_id INTEGER REFERENCES users(id)
      );
    `);
    db.prepare(`INSERT OR IGNORE INTO app_state (id, current_user_id) VALUES (1, NULL)`).run();
    const existingRealUser = db
      .prepare(`SELECT id FROM users WHERE telegram_user_id != ? ORDER BY id DESC LIMIT 1`)
      .get(LEGACY_TELEGRAM_USER_ID) as { id: number } | undefined;
    if (existingRealUser) {
      db.prepare(`UPDATE app_state SET current_user_id = ? WHERE id = 1`).run(existingRealUser.id);
      console.log(`[migrate] current connected account resumes as user_id=${existingRealUser.id}, with a clean per-account dataset`);
    }
  });

  run();
  console.log("[migrate] done.");
}
