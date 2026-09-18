import { db } from "../db";
import { getCurrentUserId, setCurrentUserId } from "./appStateRepo";

export interface UserRecord {
  id: number;
  telegram_user_id: string;
  username: string | null;
  created_at: string;
}

/**
 * Upserts the permanent historical record for this Telegram account (same
 * account reconnecting later keeps the same `id`, and therefore all its
 * previously-scoped data), and marks it as the currently connected account.
 */
export function upsertConnectedUser(telegramUserId: string, username: string | null): UserRecord {
  db.prepare(
    `INSERT INTO users (telegram_user_id, username) VALUES (?, ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET username = excluded.username`
  ).run(telegramUserId, username);
  const user = db
    .prepare("SELECT * FROM users WHERE telegram_user_id = ?")
    .get(telegramUserId) as UserRecord;
  setCurrentUserId(user.id);
  return user;
}

export function getConnectedUser(): UserRecord | undefined {
  const currentUserId = getCurrentUserId();
  if (currentUserId == null) return undefined;
  return db.prepare("SELECT * FROM users WHERE id = ?").get(currentUserId) as UserRecord | undefined;
}

/**
 * Called on logout. Only clears the "who's currently connected" pointer —
 * the `users` row and all of that account's data are kept, so logging the
 * same account back in later resumes exactly where it left off.
 */
export function disconnectCurrentUser(): void {
  setCurrentUserId(null);
}
