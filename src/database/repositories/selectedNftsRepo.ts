import { db } from "../db";
import { getCurrentUserId } from "./appStateRepo";

export interface SelectedNft {
  id: number;
  user_id: number;
  nft_identifier: string;
  nft_name: string;
  enabled: number;
  baselined: number;
  created_at: string;
}

function requireCurrentUserId(): number {
  const userId = getCurrentUserId();
  if (userId == null) throw new Error("No Telegram account is currently connected");
  return userId;
}

export function listSelectedNfts(): SelectedNft[] {
  const userId = getCurrentUserId();
  if (userId == null) return [];
  return db
    .prepare("SELECT * FROM selected_nfts WHERE user_id = ? ORDER BY nft_name")
    .all(userId) as SelectedNft[];
}

export function listEnabledSelectedNfts(): SelectedNft[] {
  const userId = getCurrentUserId();
  if (userId == null) return [];
  return db
    .prepare("SELECT * FROM selected_nfts WHERE user_id = ? AND enabled = 1")
    .all(userId) as SelectedNft[];
}

/**
 * Replaces the current account's full selection set with exactly the given
 * identifiers (enabled = true). Uses upsert rather than delete-and-reinsert
 * so re-saving an unchanged selection leaves existing rows untouched.
 */
export function saveSelection(items: { identifier: string; name: string }[]): void {
  const userId = requireCurrentUserId();
  const tx = db.transaction((rows: { identifier: string; name: string }[]) => {
    if (rows.length > 0) {
      const placeholders = rows.map(() => "?").join(",");
      db.prepare(
        `DELETE FROM selected_nfts WHERE user_id = ? AND nft_identifier NOT IN (${placeholders})`
      ).run(userId, ...rows.map((r) => r.identifier));
    } else {
      db.prepare("DELETE FROM selected_nfts WHERE user_id = ?").run(userId);
    }
    const upsert = db.prepare(
      `INSERT INTO selected_nfts (user_id, nft_identifier, nft_name, enabled) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, nft_identifier) DO UPDATE SET nft_name = excluded.nft_name, enabled = 1`
    );
    for (const row of rows) {
      upsert.run(userId, row.identifier, row.name);
    }
  });
  tx(items);
}

/** Marks a collection's initial snapshot scan as done (see monitor.ts). */
export function markBaselined(identifier: string): void {
  const userId = requireCurrentUserId();
  db.prepare("UPDATE selected_nfts SET baselined = 1 WHERE user_id = ? AND nft_identifier = ?").run(
    userId,
    identifier
  );
}

/** Forces a fresh snapshot scan for every collection (used on automation start). */
export function resetBaselines(): void {
  const userId = getCurrentUserId();
  if (userId == null) return;
  db.prepare("UPDATE selected_nfts SET baselined = 0 WHERE user_id = ?").run(userId);
}

export function isIdentifierSelected(identifier: string): boolean {
  const userId = getCurrentUserId();
  if (userId == null) return false;
  const row = db
    .prepare("SELECT 1 FROM selected_nfts WHERE user_id = ? AND nft_identifier = ? AND enabled = 1")
    .get(userId, identifier);
  return !!row;
}
