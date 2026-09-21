import { Api } from "teleproto";
import { computeCheck } from "teleproto/Password";
import { ensureConnected, persistSession, resetClient } from "./client";
import { normalizeLoginCode, normalizePhoneNumber } from "./codeFormat";
import { upsertUser } from "../database/repositories/usersRepo";
import { clearSession } from "./sessionStore";
import { registerOfferResolutionListener, unregisterOfferResolutionListener } from "./offers";

/**
 * Everything here is held ONLY in process memory for the lifetime of a single
 * login attempt. Nothing in this module is ever written to disk or logged.
 * Each Telegram user of the bot has their own slot, keyed by their verified
 * Telegram user id (`tenantId`), so two people logging in at once can't see
 * or complete each other's attempt.
 */
interface PendingLogin {
  phoneNumber: string;
  phoneCodeHash: string;
}

const pendingLogins = new Map<string, PendingLogin>();

export type LoginStep =
  | { step: "code_sent" }
  | { step: "password_needed" }
  | { step: "done"; userId: string; username: string | null };

export async function startLogin(tenantId: string, rawPhoneNumber: string): Promise<LoginStep> {
  const phoneNumber = normalizePhoneNumber(rawPhoneNumber);
  const client = await ensureConnected(tenantId);
  const result = await client.sendCode(
    { apiId: (client as any).apiId, apiHash: (client as any).apiHash },
    phoneNumber
  );
  pendingLogins.set(tenantId, { phoneNumber, phoneCodeHash: result.phoneCodeHash });
  return { step: "code_sent" };
}

export async function submitLoginCode(tenantId: string, rawCode: string): Promise<LoginStep> {
  const pending = pendingLogins.get(tenantId);
  if (!pending) {
    throw new Error("Avval telefon raqamini yuboring");
  }
  const code = normalizeLoginCode(rawCode);
  const client = await ensureConnected(tenantId);

  try {
    const result = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pending.phoneNumber,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: code,
      })
    );
    return await finalizeLogin(tenantId, result);
  } catch (err: any) {
    if (err?.className === "SessionPasswordNeededError" || err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return { step: "password_needed" };
    }
    throw err;
  }
}

export async function submitLoginPassword(tenantId: string, password: string): Promise<LoginStep> {
  if (!pendingLogins.has(tenantId)) {
    throw new Error("Avval telefon raqamini yuboring");
  }
  const client = await ensureConnected(tenantId);
  const passwordInfo = await client.invoke(new Api.account.GetPassword());
  const srpCheck = await computeCheck(passwordInfo, password);
  const result = await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
  return await finalizeLogin(tenantId, result);
}

async function finalizeLogin(tenantId: string, _result: unknown): Promise<LoginStep> {
  await persistSession(tenantId);
  const client = await ensureConnected(tenantId);
  const me = await client.getMe();
  const username = (me as any).username ?? null;
  // Data is scoped to the verified bot user (tenantId), not to whichever
  // Telegram account they happened to sign in with.
  upsertUser(tenantId, username);
  pendingLogins.delete(tenantId);
  registerOfferResolutionListener(tenantId);
  return { step: "done", userId: tenantId, username };
}

export function cancelPendingLogin(tenantId: string): void {
  pendingLogins.delete(tenantId);
}

export function hasPendingLogin(tenantId: string): boolean {
  return pendingLogins.has(tenantId);
}

/**
 * Official logout per https://core.telegram.org/method/auth.logOut — ends
 * the MTProto session server-side (the auth key is invalidated, so the old
 * session string would no longer work even if it weren't deleted), then
 * clears everything local for THIS user only: their encrypted session file
 * and their in-memory client (so the next login starts a genuinely fresh
 * connection). Their `users` row and data are deliberately kept, so logging
 * back in later resumes with their own data intact.
 */
export async function logout(tenantId: string): Promise<void> {
  try {
    const client = await ensureConnected(tenantId);
    await client.logOut(); // calls auth.logOut, disconnects, clears in-memory session
  } catch (err) {
    console.error(`[auth] auth.logOut failed for ${tenantId} — continuing with local cleanup regardless:`, err);
  } finally {
    clearSession(tenantId);
    resetClient(tenantId);
    unregisterOfferResolutionListener(tenantId);
    pendingLogins.delete(tenantId);
  }
}
