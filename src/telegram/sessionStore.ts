import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { StringSession } from "teleproto/sessions";
import { env } from "../config/env";

/**
 * The MTProto session string is equivalent to a login credential — anyone who
 * has it can act as the logged-in account. It is never written to the
 * database, only to this single file, encrypted at rest, and the file is
 * git-ignored.
 */

function getKey(): Buffer {
  return crypto.createHash("sha256").update(env.sessionEncryptionKey).digest();
}

export function loadSessionString(): StringSession {
  if (!fs.existsSync(env.sessionFilePath)) return new StringSession("");
  try {
    const raw = fs.readFileSync(env.sessionFilePath, "utf-8");
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

export function saveSessionString(sessionString: string): void {
  fs.mkdirSync(path.dirname(env.sessionFilePath), { recursive: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(sessionString, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(
    env.sessionFilePath,
    `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`,
    { mode: 0o600 }
  );
}

export function clearSession(): void {
  if (fs.existsSync(env.sessionFilePath)) fs.unlinkSync(env.sessionFilePath);
}
