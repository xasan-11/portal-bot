import { db } from "../db";

export type OfferStatus = "pending" | "accepted" | "declined" | "expired" | "failed";

export interface OfferRecord {
  id: number;
  user_id: number;
  nft_identifier: string;
  owner_id: string;
  stars: number;
  duration: number;
  telegram_offer_id: string | null;
  status: OfferStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Duplicate protection (scoped to one user): once ANY offer has
 * ever been sent for a given collectible instance (nft_identifier), we
 * never send another — a decline means the owner said no, and re-offering
 * the same item is exactly the duplicate-spam behavior this must prevent.
 */
export function hasBlockingOffer(userId: number, nftIdentifier: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM offers WHERE user_id = ? AND nft_identifier = ? LIMIT 1`)
    .get(userId, nftIdentifier);
  return !!row;
}

/**
 * Per-owner duplicate protection (scoped to one user): once ANY
 * offer has ever been sent to a given owner — regardless of which
 * collectible it was for, and regardless of status (pending, accepted,
 * declined, expired, failed) — that owner is never offered again, on
 * anything. One offer per owner, full stop.
 */
export function hasOwnerBeenOffered(userId: number, ownerId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM offers WHERE user_id = ? AND owner_id = ? LIMIT 1`)
    .get(userId, ownerId);
  return !!row;
}

export function createOffer(userId: number, params: {
  nftIdentifier: string;
  ownerId: string;
  stars: number;
  duration: number;
  telegramOfferId?: string;
}): OfferRecord {
  const result = db
    .prepare(
      `INSERT INTO offers (user_id, nft_identifier, owner_id, stars, duration, telegram_offer_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      userId,
      params.nftIdentifier,
      params.ownerId,
      params.stars,
      params.duration,
      params.telegramOfferId ?? null
    );
  return db.prepare("SELECT * FROM offers WHERE id = ?").get(result.lastInsertRowid) as OfferRecord;
}

/** Operates on a specific row by primary key — already unambiguous, no user scoping needed. */
export function updateOfferStatus(id: number, status: OfferStatus): void {
  db.prepare("UPDATE offers SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    id
  );
}

export function updateOfferStatusByOwnerAndNft(
  userId: number,
  ownerId: string,
  nftIdentifier: string,
  status: OfferStatus
): void {
  db.prepare(
    `UPDATE offers SET status = ?, updated_at = datetime('now')
     WHERE user_id = ? AND owner_id = ? AND nft_identifier = ? AND status = 'pending'`
  ).run(status, userId, ownerId, nftIdentifier);
}

export function listOffers(userId: number): OfferRecord[] {
  return db
    .prepare("SELECT * FROM offers WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as OfferRecord[];
}

export function listPendingOffers(userId: number): OfferRecord[] {
  return db
    .prepare("SELECT * FROM offers WHERE user_id = ? AND status = 'pending'")
    .all(userId) as OfferRecord[];
}

export function countByStatus(userId: number, status: OfferStatus): number {
  const row = db
    .prepare("SELECT COUNT(*) as c FROM offers WHERE user_id = ? AND status = ?")
    .get(userId, status) as { c: number };
  return row.c;
}
