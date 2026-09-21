import { errors } from "teleproto";
import { getSettings } from "../database/repositories/settingsRepo";
import { listEnabledSelectedNfts, markBaselined, resetBaselines } from "../database/repositories/selectedNftsRepo";
import { getResaleListings } from "../telegram/gifts";
import { sendGiftOffer, registerOfferResolutionListener } from "../telegram/offers";
import { checkOwnerEligibility } from "../telegram/ownerChecks";
import { addOwnerToOfferFolder, removeOwnerFromOfferFolder } from "../telegram/folders";
import { getStarsBalance } from "../telegram/balance";
import { upsertSeenNft, markProcessed } from "../database/repositories/nftsRepo";
import { ensureConnected } from "../telegram/client";
import { isSpamRestrictionError, describeError, getFloodWaitSeconds } from "../telegram/spamErrors";
import {
  hasBlockingOffer,
  hasOwnerBeenOffered,
  createOffer,
  listPendingOffers,
  updateOfferStatus,
} from "../database/repositories/offersRepo";

export type AutomationStatus = "stopped" | "running" | "paused_spam" | "paused_balance";

/**
 * Spam/flood restrictions (PEER_FLOOD, FLOOD_WAIT, ...) put only the affected
 * account into a waiting state (see enterRestriction) and clear themselves;
 * they are logged, never reported to anyone. A low Stars balance also pauses
 * and auto-resumes — balance has a real official check
 * (`payments.getStarsStatus`).
 */
const PAUSE_RECHECK_INTERVAL_MS = 90_000; // 1.5 minutes — within the requested 1-2 minute range

/** Only listings first seen within this window get an offer. */
const NEW_LISTING_WINDOW_MS = 60_000;

/**
 * Identifies one bot user: `tenantId` is their verified Telegram user id
 * (keys their MTProto client and session file), `userId` is their `users.id`
 * (scopes every DB row). Each user has fully independent automation state.
 */
export interface TenantCtx {
  tenantId: string;
  userId: number;
}

interface AutomationState {
  status: AutomationStatus;
  timer: NodeJS.Timeout | null;
  ticking: boolean;
  /** Set while status is paused_spam: why we're waiting and when to resume / re-probe. */
  restriction: { kind: "flood_wait" | "peer_flood"; resumeAt: number } | null;
  /** Index into the PEER_FLOOD backoff; only reset by a successful send, so a flood right after a probe keeps escalating. */
  peerFloodStep: number;
}

const states = new Map<number, AutomationState>();

function getState(ctx: TenantCtx): AutomationState {
  let st = states.get(ctx.userId);
  if (!st) {
    st = { status: "stopped", timer: null, ticking: false, restriction: null, peerFloodStep: 0 };
    states.set(ctx.userId, st);
  }
  return st;
}

function setStatus(ctx: TenantCtx, status: AutomationStatus): void {
  getState(ctx).status = status;
}

export function getAutomationStatus(ctx: TenantCtx): AutomationStatus {
  return getState(ctx).status;
}

/** True whenever automation is active in any form (running or paused) — i.e. not fully stopped. */
export function isAutomationRunning(ctx: TenantCtx): boolean {
  return getState(ctx).status !== "stopped";
}

export function startAutomation(ctx: TenantCtx): void {
  const st = getState(ctx);
  if (st.status !== "stopped") return;
  st.status = "running";
  st.restriction = null;
  resetBaselines(ctx.userId); // listings that appeared while we weren't watching aren't "fresh"
  registerOfferResolutionListener(ctx.tenantId);
  scheduleNextTick(ctx, 0);
}

/** Manual stop (Stop button / logout / removal): no more sending AND no more background monitoring. Offers already sent are left alone. Sends no notification. */
export function stopAutomation(ctx: TenantCtx): void {
  const st = getState(ctx);
  st.status = "stopped";
  if (st.timer) clearTimeout(st.timer);
  st.timer = null;
}

/** PEER_FLOOD has no stated wait, so it is re-probed on this backoff (minutes), capped at the last value. */
const PEER_FLOOD_BACKOFF_MIN = [5, 10, 15, 30];

/**
 * Puts THIS account into the waiting state after a spam/flood error.
 * Automation stays "on" (monitoring keeps ticking, nothing is sent) and
 * resumes by itself: FLOOD_WAIT_X waits exactly X seconds; PEER_FLOOD is
 * probed with a harmless getMe on a 5 -> 10 -> 15 -> 30 min backoff. Only
 * logged, never sent to anyone. Other accounts have their own state.
 */
function enterRestriction(ctx: TenantCtx, err: unknown): void {
  const st = getState(ctx);
  if (st.status === "stopped") return; // user stopped it meanwhile
  const now = Date.now();
  const waitSec = getFloodWaitSeconds(err);

  if (waitSec != null) {
    const resumeAt = now + (waitSec + 1) * 1000;
    st.restriction = { kind: "flood_wait", resumeAt: Math.max(resumeAt, st.restriction?.resumeAt ?? 0) };
    st.status = "paused_spam";
    console.warn(`[automation] Akkaunt ${ctx.tenantId}: ${describeError(err)} aniqlandi, ${waitSec}s kutilmoqda...`);
    return;
  }

  if (st.restriction) return; // already waiting — don't escalate the backoff from side effects
  const minutes = PEER_FLOOD_BACKOFF_MIN[Math.min(st.peerFloodStep, PEER_FLOOD_BACKOFF_MIN.length - 1)];
  st.peerFloodStep++;
  st.restriction = { kind: "peer_flood", resumeAt: now + minutes * 60_000 };
  st.status = "paused_spam";
  console.warn(`[automation] Akkaunt ${ctx.tenantId}: ${describeError(err)} aniqlandi, kutilmoqda (${minutes} daqiqadan keyin qayta tekshiriladi)...`);
}

function releaseRestriction(ctx: TenantCtx): void {
  const st = getState(ctx);
  st.restriction = null;
  if (st.status === "paused_spam") st.status = "running";
  console.log(`[automation] Akkaunt ${ctx.tenantId}: cheklov tugadi, davom etilmoqda`);
}

/**
 * Called at the start of every tick while restricted. Returns true if this
 * tick should be skipped entirely (no Telegram calls at all).
 */
async function handleRestriction(ctx: TenantCtx): Promise<boolean> {
  const st = getState(ctx);
  const r = st.restriction;
  if (st.status !== "paused_spam") return false;
  if (!r) {
    releaseRestriction(ctx);
    return false;
  }
  const now = Date.now();
  if (r.kind === "flood_wait") {
    if (now < r.resumeAt) return true; // still inside the wait: don't touch Telegram
    releaseRestriction(ctx);
    return false;
  }
  // PEER_FLOOD: monitoring continues (read-only, nothing sent) until the next probe is due.
  if (now < r.resumeAt) return false;
  try {
    await (await ensureConnected(ctx.tenantId)).getMe();
    releaseRestriction(ctx);
    return false;
  } catch (err) {
    const minutes = PEER_FLOOD_BACKOFF_MIN[Math.min(st.peerFloodStep, PEER_FLOOD_BACKOFF_MIN.length - 1)];
    st.peerFloodStep++;
    st.restriction = { kind: "peer_flood", resumeAt: Date.now() + minutes * 60_000 };
    console.warn(`[automation] Akkaunt ${ctx.tenantId}: tekshiruv o'tmadi (${describeError(err)}), yana ${minutes} daqiqadan keyin tekshiriladi`);
    return false;
  }
}

function scheduleNextTick(ctx: TenantCtx, delayMs?: number): void {
  const st = getState(ctx);
  if (st.status === "stopped") return;
  const settings = getSettings(ctx.userId);
  // While waiting out a FLOOD_WAIT, wake exactly when it ends instead of polling.
  const floodWakeMs =
    st.status === "paused_spam" && st.restriction?.kind === "flood_wait"
      ? Math.min(Math.max(st.restriction.resumeAt - Date.now(), 1000), 3_600_000)
      : null;
  const delay =
    delayMs ??
    floodWakeMs ??
    (st.status === "running" ? settings.monitoringIntervalSeconds * 1000 : PAUSE_RECHECK_INTERVAL_MS);
  st.timer = setTimeout(async () => {
    if (!st.ticking) {
      st.ticking = true;
      try {
        await tick(ctx);
      } catch (err) {
        console.error(`[automation] monitoring tick failed (user ${ctx.tenantId}):`, err);
      } finally {
        st.ticking = false;
      }
    }
    scheduleNextTick(ctx);
  }, delay);
}

async function tick(ctx: TenantCtx): Promise<void> {
  const { tenantId, userId } = ctx;
  const settings = getSettings(userId);

  if (await handleRestriction(ctx)) return;

  if (getAutomationStatus(ctx) === "paused_balance") {
    const balance = await getStarsBalance(tenantId);
    if (balance != null && balance >= settings.stars) {
      console.log(`[automation] balance recovered (${balance} ⭐, user ${tenantId}) — resuming`);
      setStatus(ctx, "running");
    }
  }

  const selected = listEnabledSelectedNfts(userId);

  for (const nft of selected) {
    // Re-read via the exported getter (not the closed-over `status`) — this can
    // legitimately change while awaiting network calls below (e.g. the user
    // hits Stop mid-tick), and going through a function call avoids
    // TypeScript incorrectly treating the earlier narrowing as still valid
    // across those `await` points.
    if (getAutomationStatus(ctx) === "stopped") return;

    let listings;
    try {
      listings = await getResaleListings(tenantId, nft.nft_identifier);
    } catch (err) {
      if (isSpamRestrictionError(err)) return enterRestriction(ctx, err);
      console.error(`[automation] failed to fetch resale listings for ${nft.nft_name}:`, err);
      continue;
    }

    // Telegram exposes no listing timestamp, so "listed just now" is
    // inferred from our own polling: the first scan of a collection only
    // records what's already there (snapshot); after that, a listing is a
    // candidate only if we first saw it within NEW_LISTING_WINDOW_MS.
    const isSnapshotScan = nft.baselined === 0;

    for (const listing of listings) {
      if (getAutomationStatus(ctx) === "stopped") return;

      // Discovery/logging always happens, even while paused — only sending is gated.
      const seen = upsertSeenNft(userId, {
        identifier: listing.slug,
        name: listing.name,
        ownerId: listing.ownerId,
      });

      if (isSnapshotScan) continue; // already on the market before we started watching

      const ageMs = Date.now() - Date.parse(seen.first_seen_at + "Z");
      if (ageMs > NEW_LISTING_WINDOW_MS) continue; // not a fresh listing

      if (hasOwnerBeenOffered(userId, listing.ownerId)) {
        continue; // this owner already received an offer (any NFT, any status) — one offer per owner, full stop
      }

      if (hasBlockingOffer(userId, listing.slug)) {
        continue; // already offered on this exact collectible instance — skip (duplicate protection)
      }

      if (!settings.autoOffer) {
        continue; // matched and logged, but sending is disabled in settings
      }

      if (getAutomationStatus(ctx) !== "running") {
        continue; // paused on balance
      }

      let eligibility;
      try {
        eligibility = await checkOwnerEligibility(tenantId, listing.ownerPeer, {
          maxOwnerLevel: settings.maxOwnerLevel,
          maxOwnerNftCount: settings.maxOwnerNftCount,
        });
      } catch (err) {
        if (isSpamRestrictionError(err)) return enterRestriction(ctx, err);
        console.error(`[automation] failed to check owner eligibility for ${listing.slug}:`, err);
        continue; // can't verify the owner meets the criteria — don't offer
      }
      if (!eligibility.eligible) {
        continue; // owner's level or NFT count is outside the configured limits
      }

      try {
        const { telegramOfferId } = await sendGiftOffer(tenantId, {
          ownerPeer: listing.ownerPeer,
          slug: listing.slug,
          stars: settings.stars,
          durationSeconds: settings.duration,
        });
        createOffer(userId, {
          nftIdentifier: listing.slug,
          ownerId: listing.ownerId,
          stars: settings.stars,
          duration: settings.duration,
          telegramOfferId,
        });
        markProcessed(userId, listing.slug, "processed");
        getState(ctx).peerFloodStep = 0; // a real send went through: the account is genuinely healthy again
        await addOwnerToOfferFolder(tenantId, listing.ownerPeer, listing.ownerId);
      } catch (err) {
        if (isSpamRestrictionError(err)) {
          return enterRestriction(ctx, err);
        } else if (err instanceof errors.BalanceTooLowError) {
          console.warn(`[automation] BALANCE_TOO_LOW on ${listing.slug} — pausing new offers, monitoring continues`);
          setStatus(ctx, "paused_balance");
        } else {
          console.error(`[automation] failed to send offer for ${listing.slug}:`, err);
          markProcessed(userId, listing.slug, "skipped");
        }
      }
    }

    if (isSnapshotScan) markBaselined(userId, nft.nft_identifier);
  }

  if (getAutomationStatus(ctx) === "running") {
    await expireStaleOffers(ctx);
  }
}

/** Fallback in case a decline/accept service message was missed. */
async function expireStaleOffers(ctx: TenantCtx): Promise<void> {
  const now = Date.now();
  for (const offer of listPendingOffers(ctx.userId)) {
    const createdAtMs = Date.parse(offer.created_at + "Z");
    if (now - createdAtMs > offer.duration * 1000) {
      updateOfferStatus(offer.id, "expired");
      await removeOwnerFromOfferFolder(ctx.tenantId, offer.owner_id);
    }
  }
}
