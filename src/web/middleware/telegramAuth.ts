import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../../config/env";
import { tenantFor } from "../../tenant";
import type { TenantCtx } from "../../automation/monitor";

/** initData older than this is rejected (replay protection). */
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export interface VerifiedInitData {
  userId: number;
  username: string | null;
}

/**
 * Validates Telegram WebApp initData exactly as documented at
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app :
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 * where data_check_string is every received field except `hash`, as
 * `key=value` lines sorted alphabetically and joined by "\n". Returns the
 * user only if the signature matches and the data is fresh.
 */
export function verifyInitData(initData: string, botToken = env.botToken, now = Date.now()): VerifiedInitData | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "");
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) return null;
    return { userId: user.id, username: typeof user.username === "string" ? user.username : null };
  } catch {
    return null;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    tenant?: TenantCtx;
  }
}

/**
 * Every /api request must carry `Authorization: tma <initData>`. The user id
 * used from here on is ONLY the one signed by Telegram — never anything the
 * client sends in a body/query/header. (Approved-list check currently disabled.)
 */
export function requireApprovedTelegramUser(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";
  const verified = initData ? verifyInitData(initData) : null;
  if (!verified) {
    return res.status(401).json({ error: "Telegram orqali tasdiqlanmadi. Ilovani bot ichidan oching." });
  }
  // Kirish nazorati vaqtincha o'chirilgan: identifikatsiya Telegram tomonidan tasdiqlanadi,
  // lekin approved_users ro'yxatida bo'lish shart emas. Qayta yoqish:
  // if (!isApproved(verified.userId)) return res.status(403).json({ error: "Ruxsat berilmagan" });
  req.tenant = tenantFor(verified.userId, verified.username);
  next();
}
