import crypto from "node:crypto";
import { Api } from "teleproto";
import { Raw } from "teleproto/events";
import bigInt from "big-integer";
import { ensureConnected } from "./client";
import { withRetry } from "./retry";
import { updateOfferStatusByOwnerAndNft } from "../database/repositories/offersRepo";
import { removeOwnerFromOfferFolder } from "./folders";

export async function sendGiftOffer(params: {
  ownerPeer: Api.TypePeer;
  slug: string;
  stars: number;
  durationSeconds: number;
}): Promise<{ telegramOfferId: string }> {
  const client = await ensureConnected();
  const randomId = bigInt(crypto.randomBytes(8).toString("hex"), 16);

  await withRetry(
    () =>
      client.invoke(
        new Api.payments.SendStarGiftOffer({
          peer: params.ownerPeer,
          slug: params.slug,
          price: new Api.StarsAmount({ amount: bigInt(params.stars), nanos: 0 }),
          duration: params.durationSeconds,
          randomId,
        })
      ),
    { label: "payments.sendStarGiftOffer", retries: 2 }
  );

  return { telegramOfferId: randomId.toString() };
}

let listenerRegistered = false;

/**
 * Listens for the service messages Telegram emits when a sent offer is
 * resolved, so offer status in the dashboard reflects reality without
 * polling. Duration-based expiry is handled separately as a fallback in the
 * monitor loop, in case this event is missed (client restart, etc).
 *
 * BUG FIX: this previously used the `NewMessage` event, which explicitly
 * discards anything that isn't an `Api.Message` (see
 * node_modules/teleproto/events/NewMessage.js — `build()` returns undefined
 * unless `update.message instanceof Api.Message`). Offer accept/decline
 * notifications arrive as `Api.MessageService` (a distinct constructor for
 * messages that carry a `MessageAction` instead of text), which `NewMessage`
 * silently drops — so declines were never actually seen, regardless of the
 * status-matching logic below. `ChatAction` doesn't work either: it only
 * recognizes a hardcoded whitelist of chat-management actions, which
 * doesn't include gift-offer actions. `Raw` receives every update
 * unfiltered, so we inspect `Api.MessageService` ourselves instead of
 * relying on either built-in event class.
 */
export function registerOfferResolutionListener(): void {
  if (listenerRegistered) return;
  listenerRegistered = true;

  ensureConnected().then((client) => {
    client.addEventHandler(async (update: Api.TypeUpdate) => {
      if (!(update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage)) {
        return;
      }
      const message = update.message;
      if (!(message instanceof Api.MessageService)) return;
      const action = message.action;
      if (!action) return;

      const peerId = message.peerId;
      const ownerId =
        peerId instanceof Api.PeerUser
          ? String(peerId.userId)
          : peerId instanceof Api.PeerChannel
            ? String(peerId.channelId)
            : peerId instanceof Api.PeerChat
              ? String(peerId.chatId)
              : "";
      if (!ownerId) return;

      // nft_identifier in our DB is the per-instance slug, not the collection gift_id.
      if (action instanceof Api.MessageActionStarGiftUnique && action.fromOffer) {
        const slug = action.gift instanceof Api.StarGiftUnique ? action.gift.slug : "";
        if (slug) updateOfferStatusByOwnerAndNft(ownerId, slug, "accepted");
      } else if (action instanceof Api.MessageActionStarGiftPurchaseOfferDeclined) {
        const slug = action.gift instanceof Api.StarGiftUnique ? action.gift.slug : "";
        if (slug) {
          const status = action.expired ? "expired" : "declined";
          updateOfferStatusByOwnerAndNft(ownerId, slug, status);
          await removeOwnerFromOfferFolder(ownerId);
        }
      }
    }, new Raw({ types: [Api.UpdateNewMessage, Api.UpdateNewChannelMessage] }));
  });
}
