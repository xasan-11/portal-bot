import { db } from "../db";

export interface UserRecord {
  id: number;
  telegram_user_id: string;
  username: string | null;
  created_at: string;
}

/**
 * Upserts the permanent record for a Telegram user (identified by the id
 * verified from Telegram WebApp initData / the bot update, never by which
 * account they log in with). The same user keeps the same `id` — and all
 * their scoped data — across logout/login.
 */
export function upsertUser(telegramUserId: string, username: string | null): UserRecord {
  db.prepare(
    `INSERT INTO users (telegram_user_id, username) VALUES (?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET username = COALESCE(excluded.username, users.username)`
  ).run(telegramUserId, username);
  return db.prepare("SELECT * FROM users WHERE telegram_user_id = ?").get(telegramUserId) as UserRecord;
}

export function getUserByTelegramId(telegramUserId: string): UserRecord | undefined {
  return db.prepare("SELECT * FROM users WHERE telegram_user_id = ?").get(telegramUserId) as
    | UserRecord
    | undefined;
}
