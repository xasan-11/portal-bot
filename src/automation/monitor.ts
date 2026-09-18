import { errors } from "teleproto";
import { getSettings } from "../database/repositories/settingsRepo";
import { listEnabledSelectedNfts, markBaselined, resetBaselines } from "../database/repositories/selectedNftsRepo";
import { getResaleListings } from "../telegram/gifts";
import { sendGiftOffer, registerOfferResolutionListener } from "../telegram/offers";
import { checkOwnerEligibility } from "../telegram/ownerChecks";
import { addOwnerToOfferFolder, removeOwnerFromOfferFolder } from "../telegram/folders";
import { getStarsBalance } from "../telegram/balance";
import { upsertSeenNft, markProcessed } from "../database/repositories/nftsRepo";
import {
  hasBlockingOffer,
  hasOwnerBeenOffered,
  createOffer,
  listPendingOffers,
  updateOfferStatus,
} from "../database/repositories/offersRepo";

export type AutomationStatus = "stopped" | "running" | "paused_spam" | "paused_balance";

/**
 * Neither PEER_FLOOD nor BALANCE_TOO_LOW has a dedicated "check status"
 * MTProto method (verified: https://core.telegram.org/api/errors.json has
 * no PEER_FLOOD entry at all, and no official docs describe a standalone
 * spam-restriction query). The only way to know a flood restriction has
 * lifted is to retry the exact kind of action that triggered it — a
 * generic harmless call (e.g. help.getConfig) wouldn't be representative,
 * since PEER_FLOOD gates specific "contacting a new peer" actions, not
 * reads. So the spam recheck below allows exactly one real send attempt
 * per pause cycle, using the next legitimately-eligible candidate that
 * discovery already found — not a wasted or fabricated action; it's the
 * real offer we already intended to send. Balance has a real official
 * check (`payments.getStarsStatus`), so that one is a genuine harmless read.
 */
const PAUSE_RECHECK_INTERVAL_MS = 90_000; // 1.5 minutes — within the requested 1-2 minute range

/** Only listings first seen within this window get an offer. */
const NEW_LISTING_WINDOW_MS = 60_000;

let status: AutomationStatus = "stopped";
let timer: NodeJS.Timeout | null = null;
let ticking = false;

export function getAutomationStatus(): AutomationStatus {
  return status;
}

/** True whenever automation is active in any form (running or paused) — i.e. not fully stopped. */
export function isAutomationRunning(): boolean {
  return status !== "stopped";
}

export function startAutomation(): void {
  if (status !== "stopped") return;
  status = "running";
  resetBaselines(); // listings that appeared while we weren't watching aren't "fresh"
  registerOfferResolutionListener();
  scheduleNextTick(0);
}

/** Full stop: no more sending AND no more background monitoring. Offers already sent are left alone. */
export function stopAutomation(): void {
  status = "stopped";
  if (timer) clearTimeout(timer);
  timer = null;
}

function scheduleNextTick(delayMs?: number): void {
  if (status === "stopped") return;
  const settings = getSettings();
  const delay =
    delayMs ?? (status === "running" ? settings.monitoringIntervalSeconds * 1000 : PAUSE_RECHECK_INTERVAL_MS);
  timer = setTimeout(async () => {
    if (!ticking) {
      ticking = true;
      try {
        await tick();
      } catch (err) {
        console.error("[automation] monitoring tick failed:", err);
      } finally {
        ticking = false;
      }
    }
    scheduleNextTick();
  }, delay);
}

async function tick(): Promise<void> {
  const settings = getSettings();

  if (status === "paused_balance") {
    const balance = await getStarsBalance();
    if (balance != null && balance >= settings.stars) {
      console.log(`[automation] balance recovered (${balance} ⭐) — resuming`);
      status = "running";
    }
  }

  // Spam pause gets exactly one real send attempt this tick (see comment above);
  // everything else (discovery/logging, balance-paused ticks, stopped) sends freely
  // or not at all based on `status` alone.
  let spamProbeAvailable = status === "paused_spam";

  const selected = listEnabledSelectedNfts();

  for (const nft of selected) {
    // Re-read via the exported getter (not the closed-over `status`) — this can
    // legitimately change while awaiting network calls below (e.g. the user
    // hits Stop mid-tick), and going through a function call avoids
    // TypeScript incorrectly treating the earlier narrowing as still valid
    // across those `await` points.
    if (getAutomationStatus() === "stopped") return;

    let listings;
    try {
      listings = await getResaleListings(nft.nft_identifier);
    } catch (err) {
      console.error(`[automation] failed to fetch resale listings for ${nft.nft_name}:`, err);
      continue;
    }

    // Telegram exposes no listing timestamp, so "listed just now" is
    // inferred from our own polling: the first scan of a collection only
    // records what's already there (snapshot); after that, a listing is a
    // candidate only if we first saw it within NEW_LISTING_WINDOW_MS.
    const isSnapshotScan = nft.baselined === 0;

    for (const listing of listings) {
      if (getAutomationStatus() === "stopped") return;

      // Discovery/logging always happens, even while paused — only sending is gated.
      const seen = upsertSeenNft({
        identifier: listing.slug,
        name: listing.name,
        ownerId: listing.ownerId,
      });

      if (isSnapshotScan) continue; // already on the market before we started watching

      const ageMs = Date.now() - Date.parse(seen.first_seen_at + "Z");
      if (ageMs > NEW_LISTING_WINDOW_MS) continue; // not a fresh listing

      if (hasOwnerBeenOffered(listing.ownerId)) {
        continue; // this owner already received an offer (any NFT, any status) — one offer per owner, full stop
      }

      if (hasBlockingOffer(listing.slug)) {
        continue; // already offered on this exact collectible instance — skip (duplicate protection)
      }

      if (!settings.autoOffer) {
        continue; // matched and logged, but sending is disabled in settings
      }

      const canAttemptSend = getAutomationStatus() === "running" || spamProbeAvailable;
      if (!canAttemptSend) {
        continue; // paused on balance, or spam probe already used this tick
      }

      let eligibility;
      try {
        eligibility = await checkOwnerEligibility(listing.ownerPeer, {
          maxOwnerLevel: settings.maxOwnerLevel,
          maxOwnerNftCount: settings.maxOwnerNftCount,
        });
      } catch (err) {
        console.error(`[automation] failed to check owner eligibility for ${listing.slug}:`, err);
        continue; // can't verify the owner meets the criteria — don't offer
      }
      if (!eligibility.eligible) {
        continue; // owner's level or NFT count is outside the configured limits
      }

      const wasProbe = spamProbeAvailable;
      if (wasProbe) spamProbeAvailable = false; // consume the probe regardless of outcome

      try {
        const { telegramOfferId } = await sendGiftOffer({
          ownerPeer: listing.ownerPeer,
          slug: listing.slug,
          stars: settings.stars,
          durationSeconds: settings.duration,
        });
        createOffer({
          nftIdentifier: listing.slug,
          ownerId: listing.ownerId,
          stars: settings.stars,
          duration: settings.duration,
          telegramOfferId,
        });
        markProcessed(listing.slug, "processed");
        await addOwnerToOfferFolder(listing.ownerPeer, listing.ownerId);
        if (wasProbe) {
          console.log(`[automation] spam probe succeeded (${listing.slug}) — resuming normal operation`);
          status = "running";
        }
      } catch (err) {
        if (err instanceof errors.PeerFloodError) {
          console.warn(`[automation] PEER_FLOOD on ${listing.slug} — pausing new offers, monitoring continues`);
          status = "paused_spam";
        } else if (err instanceof errors.BalanceTooLowError) {
          console.warn(`[automation] BALANCE_TOO_LOW on ${listing.slug} — pausing new offers, monitoring continues`);
          status = "paused_balance";
        } else {
          console.error(`[automation] failed to send offer for ${listing.slug}:`, err);
          markProcessed(listing.slug, "skipped");
        }
      }
    }

    if (isSnapshotScan) markBaselined(nft.nft_identifier);
  }

  if (getAutomationStatus() === "running") {
    await expireStaleOffers();
  }
}

/** Fallback in case a decline/accept service message was missed. */
async function expireStaleOffers(): Promise<void> {
  const now = Date.now();
  for (const offer of listPendingOffers()) {
    const createdAtMs = Date.parse(offer.created_at + "Z");
    if (now - createdAtMs > offer.duration * 1000) {
      updateOfferStatus(offer.id, "expired");
      await removeOwnerFromOfferFolder(offer.owner_id);
    }
  }
}
