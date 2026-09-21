import { db } from "../db";
import { env } from "../../config/env";

export interface ApprovedUser {
  telegram_user_id: number;
  added_by: number;
  added_at: number; // unix seconds
  note: string | null;
}

/** The admin is always approved (checked first, so they can never lock themselves out). */
export function isAdmin(telegramUserId: number | string | undefined | null): boolean {
  return env.adminTelegramId != null && Number(telegramUserId) === env.adminTelegramId;
}

export function isApproved(telegramUserId: number | string | undefined | null): boolean {
  if (telegramUserId == null) return false;
  const id = Number(telegramUserId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  if (isAdmin(id)) return true;
  return !!db.prepare("SELECT 1 FROM approved_users WHERE telegram_user_id = ?").get(id);
}

export function addApprovedUser(telegramUserId: number, addedBy: number, note?: string | null): void {
  db.prepare(
    `INSERT INTO approved_users (telegram_user_id, added_by, added_at, note)
     VALUES (?, ?, strftime('%s','now'), ?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET note = excluded.note`
  ).run(telegramUserId, addedBy, note ?? null);
}

/** Returns whether a row was actually removed. */
export function removeApprovedUser(telegramUserId: number): boolean {
  return db.prepare("DELETE FROM approved_users WHERE telegram_user_id = ?").run(telegramUserId).changes > 0;
}

export function listApprovedUsers(): ApprovedUser[] {
  return db.prepare("SELECT * FROM approved_users ORDER BY added_at").all() as ApprovedUser[];
}
