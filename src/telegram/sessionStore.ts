import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { StringSession } from "teleproto/sessions";
import { env } from "../config/env";

/**
 * The MTProto session string is equivalent to a login credential — anyone who
 * has it can act as the logged-in account. It is never written to the
 * database, only to per-user files (one per Telegram user id), encrypted at
 * rest, in a git-ignored directory.
 */

function getKey(): Buffer {
  return crypto.createHash("sha256").update(env.sessionEncryptionKey).digest();
}

function sessionPath(tenantId: string): string {
  if (!/^\d+$/.test(tenantId)) throw new Error("Invalid tenant id");
  return path.join(env.sessionsDir, `${tenantId}.session`);
}

export function loadSessionString(tenantId: string): StringSession {
  const file = sessionPath(tenantId);
  if (!fs.existsSync(file)) return new StringSession("");
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const [ivHex, tagHex, dataHex] = raw.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return new StringSession(decrypted.toString("utf-8"));
  } catch {
    // Corrupted or undecryptable session file — treat as logged out rather than crash.
    return new StringSession("");
  }
}

export function saveSessionString(tenantId: string, sessionString: string): void {
  fs.mkdirSync(env.sessionsDir, { recursive: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(sessionString, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(
    sessionPath(tenantId),
    `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`,
    { mode: 0o600 }
  );
}

export function clearSession(tenantId: string): void {
  const file = sessionPath(tenantId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Tenant ids that have a saved session file (used to restore everyone on boot). */
export function listSavedSessionTenantIds(): string[] {
  if (!fs.existsSync(env.sessionsDir)) return [];
  return fs
    .readdirSync(env.sessionsDir)
    .map((f) => /^(\d+)\.session$/.exec(f)?.[1])
    .filter((id): id is string => !!id);
}

/**
 * One-time upgrade from the single-account layout: the old global session
 * file belonged to the (only) owner, so it becomes the admin's session.
 */
export function migrateLegacySessionFile(): void {
  if (!fs.existsSync(env.sessionFilePath)) return;
  if (!env.adminTelegramId) {
    console.warn("[sessions] legacy session file found but ADMIN_TELEGRAM_ID is not set — leaving it untouched");
    return;
  }
  const target = sessionPath(String(env.adminTelegramId));
  if (fs.existsSync(target)) return; // admin already has a per-user session; keep legacy file as-is
  fs.mkdirSync(env.sessionsDir, { recursive: true });
  fs.renameSync(env.sessionFilePath, target);
  console.log(`[sessions] migrated legacy session file to admin (${env.adminTelegramId})`);
}
