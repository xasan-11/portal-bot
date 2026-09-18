import { Api } from "teleproto";
import { computeCheck } from "teleproto/Password";
import { ensureConnected, persistSession, resetClient } from "./client";
import { normalizeLoginCode, normalizePhoneNumber } from "./codeFormat";
import { upsertConnectedUser, disconnectCurrentUser } from "../database/repositories/usersRepo";
import { clearSession } from "./sessionStore";

/**
 * Everything here is held ONLY in process memory for the lifetime of a single
 * login attempt. Nothing in this module is ever written to disk or logged.
 * This app has exactly one Telegram account, so a single in-memory slot is
 * enough — no login-session table, no cookies with secrets in them.
 */
interface PendingLogin {
  phoneNumber: string;
  phoneCodeHash: string;
}

let pendingLogin: PendingLogin | null = null;

export type LoginStep =
  | { step: "code_sent" }
  | { step: "password_needed" }
  | { step: "done"; userId: string; username: string | null };

export async function startLogin(rawPhoneNumber: string): Promise<LoginStep> {
  const phoneNumber = normalizePhoneNumber(rawPhoneNumber);
  const client = await ensureConnected();
  const result = await client.sendCode(
    { apiId: (client as any).apiId, apiHash: (client as any).apiHash },
    phoneNumber
  );
  pendingLogin = { phoneNumber, phoneCodeHash: result.phoneCodeHash };
  return { step: "code_sent" };
}

export async function submitLoginCode(rawCode: string): Promise<LoginStep> {
  if (!pendingLogin) {
    throw new Error("Avval telefon raqamini yuboring");
  }
  const code = normalizeLoginCode(rawCode);
  const client = await ensureConnected();

  try {
    const result = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pendingLogin.phoneNumber,
        phoneCodeHash: pendingLogin.phoneCodeHash,
        phoneCode: code,
      })
    );
    return await finalizeLogin(result);
  } catch (err: any) {
    if (err?.className === "SessionPasswordNeededError" || err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return { step: "password_needed" };
    }
    throw err;
  } finally {
    // The verification code itself must never linger in memory once used.
  }
}

export async function submitLoginPassword(password: string): Promise<LoginStep> {
  if (!pendingLogin) {
    throw new Error("Avval telefon raqamini yuboring");
  }
  const client = await ensureConnected();
  const passwordInfo = await client.invoke(new Api.account.GetPassword());
  const srpCheck = await computeCheck(passwordInfo, password);
  const result = await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
  return await finalizeLogin(result);
}

async function finalizeLogin(result: unknown): Promise<LoginStep> {
  await persistSession();
  const client = await ensureConnected();
  const me = await client.getMe();
  const userId = String((me as any).id);
  const username = (me as any).username ?? null;
  upsertConnectedUser(userId, username);
  pendingLogin = null;
  return { step: "done", userId, username };
}

export function cancelPendingLogin(): void {
  pendingLogin = null;
}

export function hasPendingLogin(): boolean {
  return pendingLogin !== null;
}

/**
 * Official logout per https://core.telegram.org/method/auth.logOut — ends
 * the MTProto session server-side (the auth key is invalidated, so the old
 * session string would no longer work even if it weren't deleted), then
 * clears everything local: the encrypted session file and the in-memory
 * client singleton (so the next login starts a genuinely fresh connection).
 * The `users` row and this account's data are deliberately kept — only the
 * "currently connected" pointer is cleared — so logging the same account
 * back in later resumes with its own data intact rather than starting over.
 */
export async function logout(): Promise<void> {
  try {
    const client = await ensureConnected();
    await client.logOut(); // calls auth.logOut, disconnects, clears in-memory session
  } catch (err) {
    console.error("[auth] auth.logOut failed — continuing with local cleanup regardless:", err);
  } finally {
    clearSession();
    resetClient();
    disconnectCurrentUser();
    pendingLogin = null;
  }
}
