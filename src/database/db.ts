import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env";
import { migrateLegacySchema, ensureBaselinedColumn, migrateToMultiTenant } from "./migrate";

fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

export const db = new Database(env.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Must run before schema.sql: it upgrades any pre-existing old-shape tables
// in place, so the `CREATE TABLE IF NOT EXISTS` statements below correctly
// no-op on them instead of leaving them in their old shape forever.
migrateLegacySchema(db);
ensureBaselinedColumn(db);

const schemaPath = path.join(__dirname, "schema.sql");
db.exec(fs.readFileSync(schemaPath, "utf-8"));

migrateToMultiTenant(db, env.adminTelegramId); // after schema.sql so `users` exists on fresh DBs too
