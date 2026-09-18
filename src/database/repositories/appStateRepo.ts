import { db } from "../db";

/**
 * Single-row table tracking which `users.id` is the currently connected
 * Telegram account. Deliberately separate from `users` itself: `users` is a
 * permanent historical record (so the same account reconnecting later keeps
 * its same id and its data), while this pointer is the only thing that
 * changes on login/logout.
 */
export function getCurrentUserId(): number | null {
  const row = db.prepare("SELECT current_user_id FROM app_state WHERE id = 1").get() as
    | { current_user_id: number | null }
    | undefined;
  return row?.current_user_id ?? null;
}

export function setCurrentUserId(userId: number | null): void {
  db.prepare("UPDATE app_state SET current_user_id = ? WHERE id = 1").run(userId);
}
