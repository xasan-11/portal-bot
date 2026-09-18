import { db } from "../db";
import { getCurrentUserId } from "./appStateRepo";

export interface SelectedNft {
  id: number;
  user_id: number;
  nft_identifier: string;
  nft_name: string;
  enabled: number;
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

/** Replaces the current account's full selection set with exactly the given identifiers (enabled = true). */
export function saveSelection(items: { identifier: string; name: string }[]): void {
  const userId = requireCurrentUserId();
  const tx = db.transaction((rows: { identifier: string; name: string }[]) => {
    db.prepare("DELETE FROM selected_nfts WHERE user_id = ?").run(userId);
    const insert = db.prepare(
      "INSERT INTO selected_nfts (user_id, nft_identifier, nft_name, enabled) VALUES (?, ?, ?, 1)"
    );
    for (const row of rows) {
      insert.run(userId, row.identifier, row.name);
    }
  });
  tx(items);
}

export function isIdentifierSelected(identifier: string): boolean {
  const userId = getCurrentUserId();
  if (userId == null) return false;
  const row = db
    .prepare("SELECT 1 FROM selected_nfts WHERE user_id = ? AND nft_identifier = ? AND enabled = 1")
    .get(userId, identifier);
  return !!row;
}
