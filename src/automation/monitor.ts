import { errors } from "teleproto";
import { getSettings } from "../database/repositories/settingsRepo";
import { listEnabledSelectedNfts, markBaselined, resetBaselines } from "../database/repositories/selectedNftsRepo";
import { getResaleListings } from "../telegram/gifts";
import { sendGiftOffer, registerOfferResolutionListener } from "../telegram/offers";
import { checkOwnerEligibility } from "../telegram/ownerChecks";
import { addOwnerToOfferFolder, removeOwnerFromOfferFolder } from "../telegram/folders";
import { getStarsBalance } from "../telegram/balance";
import { upsertSeenNft, markProcessed, setNftStatus, listMatchedNfts, clearMatched } from "../database/repositories/nftsRepo";
import { getUserByTelegramId } from "../database/repositories/usersRepo";
import { isSpamRestrictionError, describeError } from "../telegram/spamErrors";
import {
  hasBlockingOffer,
  hasOwnerBeenOffered,
  createOffer,
  listPendingOffers,
  updateOfferStatus,
} from "../database/repositories/offersRepo";

export type AutomationStatus = "stopped" | "running" | "paused_spam" | "paused_balance";

/**
 * Spam/flood restrictions (PEER_FLOOD, FLOOD_WAIT, ...) no longer pause and
 * probe: they stop that account's automation and notify the admin (see
 * stopDueToSpam). Only a low Stars balance still pauses and auto-resumes —
 * balance has a real official check (`payments.getStarsStatus`).
 */
const PAUSE_RECHECK_INTERVAL_MS = 90_000; // 1.5 minutes — within the requested 1-2 minute range

/** Only listings first seen within this window get an offer. */
const NEW_LISTING_WINDOW_MS = 60_000;

type AdminNotifier = (text: string) => Promise<void>;
let notifyAdmin: AdminNotifier = async () => {};

/** Wired up at startup with the bot's sendMessage-to-admin; kept injectable so this module doesn't import the bot. */
export function setAdminNotifier(fn: AdminNotifier): void {
  notifyAdmin = fn;
}

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
}

const states = new Map<number, AutomationState>();

function getState(ctx: TenantCtx): AutomationState {
  let st = states.get(ctx.userId);
  if (!st) {
    st = { status: "stopped", timer: null, ticking: false };
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
  clearMatched(ctx.userId);
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

/**
 * Automatic stop caused by a Telegram spam/flood restriction on THIS
 * account only. Unlike the manual stop above, it reports to the admin:
 * which account, the error, and the gifts that matched but never got an
 * offer. No-op if already stopped (a tick that was mid-flight when the
 * restriction hit must not report twice).
 */
export async function stopDueToSpam(ctx: TenantCtx, err: unknown): Promise<void> {
  if (getAutomationStatus(ctx) === "stopped") return;
  stopAutomation(ctx);

  const pending = listMatchedNfts(ctx.userId);
  const username = getUserByTelegramId(ctx.tenantId)?.username;
  const lines = [
    "🚫 Spam cheklovi aniqlandi",
    `Akkaunt: ${ctx.tenantId}${username ? ` (@${username})` : ""}`,
    `Xato: ${describeError(err)}`,
    "Avtomatizatsiya to'xtatildi.",
    "",
    "Kutilayotgan (hali offer yuborilmagan) gift'lar:",
    ...(pending.length > 0 ? pending.map((n) => `• ${n.nft_identifier} → ${n.owner_id ?? "—"}`) : ["—"]),
  ];
  console.warn(`[automation] spam restriction for ${ctx.tenantId}: ${describeError(err)} — automation stopped`);
  try {
    await notifyAdmin(lines.join("\n"));
  } catch (sendErr) {
    console.error("[automation] failed to notify admin about spam restriction:", sendErr);
  }
}

function scheduleNextTick(ctx: TenantCtx, delayMs?: number): void {
  const st = getState(ctx);
  if (st.status === "stopped") return;
  const settings = getSettings(ctx.userId);
  const delay =
    delayMs ?? (st.status === "running" ? settings.monitoringIntervalSeconds * 1000 : PAUSE_RECHECK_INTERVAL_MS);
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
      if (isSpamRestrictionError(err)) return stopDueToSpam(ctx, err);
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
        if (isSpamRestrictionError(err)) return stopDueToSpam(ctx, err);
        console.error(`[automation] failed to check owner eligibility for ${listing.slug}:`, err);
        continue; // can't verify the owner meets the criteria — don't offer
      }
      if (!eligibility.eligible) {
        continue; // owner's level or NFT count is outside the configured limits
      }

      // Passed every filter: from here it is a pending gift until the offer actually goes out.
      setNftStatus(userId, listing.slug, "matched");

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
        await addOwnerToOfferFolder(tenantId, listing.ownerPeer, listing.ownerId);
      } catch (err) {
        if (isSpamRestrictionError(err)) {
          return stopDueToSpam(ctx, err); // listing stays 'matched' -> reported as pending
        } else if (err instanceof errors.BalanceTooLowError) {
          setNftStatus(userId, listing.slug, "found");
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
