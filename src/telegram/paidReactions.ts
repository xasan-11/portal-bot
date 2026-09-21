import crypto from "node:crypto";
import { Api } from "teleproto";
import bigInt from "big-integer";
import { ensureConnected } from "./client";

/** Error whose message is safe/meant to be shown to the admin as-is. */
export class UserFacingError extends Error {}

export type PostLink =
  | { kind: "username"; username: string; msgId: number }
  | { kind: "private"; channelId: string; msgId: number };

/**
 * Accepts https://t.me/<channel>/<msg>, https://t.me/c/<internalId>/<msg>
 * (private/`-100…` channels), with optional topic id, query string or
 * `t.me` without scheme. Returns null if it isn't a post link.
 */
export function parsePostLink(raw: string): PostLink | null {
  const m = raw
    .trim()
    .match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:c\/(\d+)|([A-Za-z][A-Za-z0-9_]{3,31}))\/(?:\d+\/)?(\d+)(?:[/?#].*)?$/);
  if (!m) return null;
  const msgId = Number(m[3]);
  if (!Number.isSafeInteger(msgId) || msgId <= 0 || msgId > 2_147_483_647) return null;
  return m[1] ? { kind: "private", channelId: m[1], msgId } : { kind: "username", username: m[2], msgId };
}

async function resolveChannel(tenantId: string, link: PostLink): Promise<Api.Channel> {
  const client = await ensureConnected(tenantId);
  let entity: unknown;
  try {
    if (link.kind === "username") {
      entity = await client.getEntity(link.username);
    } else {
      const peer = new Api.PeerChannel({ channelId: bigInt(link.channelId) });
      try {
        entity = await client.getEntity(peer);
      } catch {
        await client.getDialogs({ limit: 200 }); // populates the access-hash cache for channels this account is in
        entity = await client.getEntity(peer);
      }
    }
  } catch {
    throw new UserFacingError("Kanal topilmadi yoki bu akkaunt unga kira olmaydi (private kanal bo'lsa, akkaunt a'zo bo'lishi kerak).");
  }
  if (!(entity instanceof Api.Channel) || !entity.broadcast) {
    throw new UserFacingError("Stars reaksiyasi faqat kanal postlariga yuboriladi (bu havola kanal posti emas).");
  }
  return entity;
}

const RPC_ERRORS: Record<string, string> = {
  BALANCE_TOO_LOW: "Akkauntda Stars yetarli emas.",
  CHANNEL_INVALID: "Kanal noto'g'ri yoki mavjud emas.",
  PEER_ID_INVALID: "Kanal noto'g'ri yoki akkaunt unga kira olmaydi.",
  MESSAGE_ID_INVALID: "Post topilmadi (xabar ID noto'g'ri).",
  REACTIONS_COUNT_INVALID: "Bu miqdor Telegram chegarasidan tashqarida (kamaytirib ko'ring).",
  CHAT_WRITE_FORBIDDEN: "Bu akkaunt shu kanalga reaksiya yubora olmaydi.",
  RANDOM_ID_EXPIRED: "So'rov muddati o'tdi, qayta urinib ko'ring.",
  AUTH_KEY_UNREGISTERED: "Akkaunt sessiyasi yaroqsiz — qayta login kerak.",
};

/**
 * Sends `count` Stars as a paid reaction to a channel post from the given
 * account, via `messages.sendPaidReaction`
 * (https://core.telegram.org/method/messages.sendPaidReaction). Stars are
 * deducted directly from that account's balance. random_id is
 * (unixtime << 32) | random32, as the method requires.
 */
export async function sendPaidReaction(tenantId: string, link: PostLink, count: number): Promise<void> {
  const channel = await resolveChannel(tenantId, link);
  const client = await ensureConnected(tenantId);
  const randomId = bigInt(BigInt.asUintN(64, (BigInt(Math.floor(Date.now() / 1000)) << 32n) | BigInt(crypto.randomBytes(4).readUInt32BE(0))).toString());
  try {
    await client.invoke(
      new Api.messages.SendPaidReaction({ peer: channel, msgId: link.msgId, count, randomId })
    );
  } catch (err: any) {
    const code: string = err?.errorMessage ?? "";
    throw new UserFacingError(RPC_ERRORS[code] ?? `Telegram xatosi: ${code || err?.message || "noma'lum"}`);
  }
}
