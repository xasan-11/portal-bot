import { db } from "../db";

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

export function findNftByIdentifier(userId: number, identifier: string): NftRecord | undefined {
  return db
    .prepare("SELECT * FROM nfts WHERE user_id = ? AND nft_identifier = ?")
    .get(userId, identifier) as NftRecord | undefined;
}

export function upsertSeenNft(userId: number, params: { identifier: string; name: string; ownerId: string }): NftRecord {
  const existing = findNftByIdentifier(userId, params.identifier);
  if (existing) {
    db.prepare("UPDATE nfts SET owner_id = ? WHERE user_id = ? AND nft_identifier = ?").run(
      params.ownerId,
      userId,
      params.identifier
    );
    return findNftByIdentifier(userId, params.identifier)!;
  }
  db.prepare(
    "INSERT INTO nfts (user_id, nft_identifier, nft_name, owner_id, status) VALUES (?, ?, ?, ?, 'found')"
  ).run(userId, params.identifier, params.name, params.ownerId);
  return findNftByIdentifier(userId, params.identifier)!;
}

export function markProcessed(userId: number, identifier: string, status: NftRecord["status"]): void {
  db.prepare(
    "UPDATE nfts SET status = ?, processed_at = datetime('now') WHERE user_id = ? AND nft_identifier = ?"
  ).run(status, userId, identifier);
}

export function countByStatus(userId: number, status: NftRecord["status"]): number {
  const row = db
    .prepare("SELECT COUNT(*) as c FROM nfts WHERE user_id = ? AND status = ?")
    .get(userId, status) as { c: number };
  return row.c;
}

export function countAll(userId: number): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM nfts WHERE user_id = ?").get(userId) as {
    c: number;
  };
  return row.c;
}

/** Status change that leaves processed_at alone (used for the transient 'matched' state). */
export function setNftStatus(userId: number, identifier: string, status: NftRecord["status"]): void {
  db.prepare("UPDATE nfts SET status = ? WHERE user_id = ? AND nft_identifier = ?").run(status, userId, identifier);
}

/**
 * Listings that passed every filter and were about to get an offer but
 * haven't been sent one (status 'matched'): the "pending gifts" reported when
 * a spam restriction stops the automation mid-way.
 */
export function listMatchedNfts(userId: number): NftRecord[] {
  return db
    .prepare("SELECT * FROM nfts WHERE user_id = ? AND status = 'matched' ORDER BY first_seen_at")
    .all(userId) as NftRecord[];
}

/** Drops stale 'matched' markers (e.g. from an earlier stop) back to 'found'. */
export function clearMatched(userId: number): void {
  db.prepare("UPDATE nfts SET status = 'found' WHERE user_id = ? AND status = 'matched'").run(userId);
}
