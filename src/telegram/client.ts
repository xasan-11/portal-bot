import { TelegramClient } from "teleproto";
import { env } from "../config/env";
import { loadSessionString, saveSessionString } from "./sessionStore";

let client: TelegramClient | null = null;

export function getClient(): TelegramClient {
  if (!client) {
    const session = loadSessionString();
    client = new TelegramClient(session, env.telegramApiId, env.telegramApiHash, {
      connectionRetries: 5,
      // Telegram-side floods under this threshold are retried automatically
      // by the library; larger waits surface as FloodWaitError to our callers.
      floodSleepThreshold: 60,
    });
  }
  return client;
}

export async function ensureConnected(): Promise<TelegramClient> {
  const c = getClient();
  if (!c.connected) {
    await c.connect();
  }
  return c;
}

export async function isLoggedIn(): Promise<boolean> {
  try {
    const c = await ensureConnected();
    return await c.isUserAuthorized();
  } catch {
    return false;
  }
}

export async function persistSession(): Promise<void> {
  const c = getClient();
  const sessionString = (c.session as InstanceType<typeof import("teleproto/sessions").StringSession>).save() as unknown as string;
  saveSessionString(sessionString);
}

/**
 * Drops the in-memory client singleton after logout, so the next
 * `getClient()` builds a fresh one from the (now-empty) session file instead
 * of reusing a client whose auth key the server just invalidated.
 */
export function resetClient(): void {
  client = null;
}
