import type { TenantCtx } from "./automation/monitor";
import { stopAutomation } from "./automation/monitor";
import { upsertUser, getUserByTelegramId } from "./database/repositories/usersRepo";
import { logout } from "./telegram/auth";
import { listSavedSessionTenantIds } from "./telegram/sessionStore";
import { isApproved } from "./database/repositories/approvedUsersRepo";
import { isLoggedIn } from "./telegram/client";
import { registerOfferResolutionListener } from "./telegram/offers";

/** Resolves (creating if needed) the per-user context for a VERIFIED Telegram user id. */
export function tenantFor(telegramUserId: number | string, username?: string | null): TenantCtx {
  const tenantId = String(telegramUserId);
  const user = upsertUser(tenantId, username ?? null);
  return { tenantId, userId: user.id };
}

/**
 * Cuts a user off completely: stops their automation and logs their
 * Telegram session out. Called when they're removed from the allow-list.
 * Their stored data is kept, so re-adding them later resumes cleanly.
 */
export async function revokeUser(telegramUserId: number): Promise<void> {
  const tenantId = String(telegramUserId);
  const user = getUserByTelegramId(tenantId);
  if (user) stopAutomation({ tenantId, userId: user.id });
  await logout(tenantId);
}

export interface ConnectedAccount {
  tenantId: string;
  username: string | null;
}

/** Every bot user whose Telegram session is currently logged in. */
export async function listConnectedAccounts(): Promise<ConnectedAccount[]> {
  const ids = listSavedSessionTenantIds();
  const checked = await Promise.all(ids.map(async (id) => ((await isLoggedIn(id)) ? id : null)));
  return checked
    .filter((id): id is string => id !== null)
    .map((id) => ({ tenantId: id, username: getUserByTelegramId(id)?.username ?? null }));
}

/**
 * On boot: re-attach the offer-resolution listener for every approved user
 * that still has a saved session, so their sent offers keep updating even
 * before they open the app. Sessions of users no longer approved are
 * logged out instead of silently kept alive.
 */
export async function restoreSessions(): Promise<void> {
  for (const tenantId of listSavedSessionTenantIds()) {
    try {
      if (!isApproved(tenantId)) {
        console.warn(`[startup] session for ${tenantId} belongs to a non-approved user — logging it out`);
        await logout(tenantId);
        continue;
      }
      if (await isLoggedIn(tenantId)) {
        upsertUser(tenantId, null);
        registerOfferResolutionListener(tenantId);
        console.log(`[startup] restored session for ${tenantId}`);
      }
    } catch (err) {
      console.error(`[startup] could not restore session for ${tenantId}:`, err);
    }
  }
}
