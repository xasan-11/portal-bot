import { db } from "../db";
import { getCurrentUserId } from "./appStateRepo";

export interface NftRecord {
  id: number;
  user_id: number;
  nft_identifier: string;
  nft_name: string;
  owner_id: string | null;
  status: "found" | "matched" | "processed" | "skipped";
  first_seen_at: string;
  processed_at: string | null;
}

function requireCurrentUserId(): number {
  const userId = getCurrentUserId();
  if (userId == null) throw new Error("No Telegram account is currently connected");
  return userId;
}

export function findNftByIdentifier(identifier: string): NftRecord | undefined {
  const userId = getCurrentUserId();
  if (userId == null) return undefined;
  return db
    .prepare("SELECT * FROM nfts WHERE user_id = ? AND nft_identifier = ?")
    .get(userId, identifier) as NftRecord | undefined;
}

export function upsertSeenNft(params: { identifier: string; name: string; ownerId: string }): NftRecord {
  const userId = requireCurrentUserId();
  const existing = findNftByIdentifier(params.identifier);
  if (existing) {
    db.prepare("UPDATE nfts SET owner_id = ? WHERE user_id = ? AND nft_identifier = ?").run(
      params.ownerId,
      userId,
      params.identifier
    );
    return findNftByIdentifier(params.identifier)!;
  }
  db.prepare(
    "INSERT INTO nfts (user_id, nft_identifier, nft_name, owner_id, status) VALUES (?, ?, ?, ?, 'found')"
  ).run(userId, params.identifier, params.name, params.ownerId);
  return findNftByIdentifier(params.identifier)!;
}

export function markProcessed(identifier: string, status: NftRecord["status"]): void {
  const userId = requireCurrentUserId();
  db.prepare(
    "UPDATE nfts SET status = ?, processed_at = datetime('now') WHERE user_id = ? AND nft_identifier = ?"
  ).run(status, userId, identifier);
}

export function countByStatus(status: NftRecord["status"]): number {
  const userId = getCurrentUserId();
  if (userId == null) return 0;
  const row = db
    .prepare("SELECT COUNT(*) as c FROM nfts WHERE user_id = ? AND status = ?")
    .get(userId, status) as { c: number };
  return row.c;
}

export function countAll(): number {
  const userId = getCurrentUserId();
  if (userId == null) return 0;
  const row = db.prepare("SELECT COUNT(*) as c FROM nfts WHERE user_id = ?").get(userId) as {
    c: number;
  };
  return row.c;
}
