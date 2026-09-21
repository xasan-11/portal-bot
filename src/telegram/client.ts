import { TelegramClient } from "teleproto";
import { env } from "../config/env";
import { loadSessionString, saveSessionString } from "./sessionStore";

/** One MTProto client per Telegram user (keyed by their Telegram user id). */
const clients = new Map<string, TelegramClient>();

export function getClient(tenantId: string): TelegramClient {
  let client = clients.get(tenantId);
  if (!client) {
    const session = loadSessionString(tenantId);
    client = new TelegramClient(session, env.telegramApiId, env.telegramApiHash, {
      connectionRetries: 5,
      // Telegram-side floods under this threshold are retried automatically
      // by the library; larger waits surface as FloodWaitError to our callers.
      floodSleepThreshold: 60,
    });
    clients.set(tenantId, client);
  }
  return client;
}

export async function ensureConnected(tenantId: string): Promise<TelegramClient> {
  const c = getClient(tenantId);
  if (!c.connected) {
    await c.connect();
  }
  return c;
}

export async function isLoggedIn(tenantId: string): Promise<boolean> {
  try {
    const c = await ensureConnected(tenantId);
    return await c.isUserAuthorized();
  } catch {
    return false;
  }
}

export async function persistSession(tenantId: string): Promise<void> {
  const c = getClient(tenantId);
  const sessionString = (c.session as InstanceType<typeof import("teleproto/sessions").StringSession>).save() as unknown as string;
  saveSessionString(tenantId, sessionString);
}

/**
 * Drops this user's in-memory client after logout, so the next
 * `getClient()` builds a fresh one from the (now-empty) session file instead
 * of reusing a client whose auth key the server just invalidated.
 */
export function resetClient(tenantId: string): void {
  clients.delete(tenantId);
}
