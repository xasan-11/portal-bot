import { Api } from "teleproto";
import bigInt from "big-integer";
import { ensureConnected } from "./client";
import { withRetry } from "./retry";
import { getGiftThumbnailUrl, mapWithConcurrency } from "./thumbnails";

export interface NftCatalogItem {
  identifier: string; // exact Telegram collectible identifier (base gift id) — used for filtering
  name: string;
  icon: string; // emoji fallback, used when imageUrl is null or fails to load
  imageUrl: string | null;
  stars: number; // base price, for display only
}

export interface ResaleListing {
  slug: string;
  identifier: string; // base gift_id, matches NftCatalogItem.identifier
  name: string;
  num: number;
  ownerId: string;
  ownerPeer: Api.TypePeer;
  resellStars: number | null;
}

const ICONS = ["🎁", "🧸", "💎", "☕", "🌟", "🔮", "🪄", "🎩", "🕯️", "🦋"];

function pickIcon(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ICONS[hash % ICONS.length];
}

function cleanTitle(title: string): string {
  return title.replace(/\s*#\d+$/, "").trim();
}

/**
 * The platform-wide gift catalog — every gift model Telegram currently
 * offers (`payments.getStarGifts`), NOT anything owned by this account. This
 * populates the "🖼 NFT tanlash" list so the user can pick which *types*
 * (e.g. "Plush Pepe", "Toy Bear") the automation should watch for on the
 * resale market, independent of what they personally happen to own.
 *
 * Only gifts that can be upgraded into a collectible (`upgradeStars` set) are
 * included — plain non-upgradable gifts never appear as resale NFTs, so
 * they'd be useless as a monitoring filter.
 */
export async function getGlobalGiftCatalog(tenantId: string): Promise<NftCatalogItem[]> {
  const client = await ensureConnected(tenantId);

  const result = await withRetry(
    () => client.invoke(new Api.payments.GetStarGifts({ hash: 0 })),
    { label: "payments.getStarGifts" }
  );

  if (!(result instanceof Api.payments.StarGifts)) return []; // StarGiftsNotModified (cache hash matched)

  const candidates = result.gifts.filter(
    (gift): gift is Api.StarGift => gift instanceof Api.StarGift && gift.upgradeStars != null
  );

  return mapWithConcurrency(candidates, 6, async (gift) => {
    const identifier = String(gift.id);
    const name = gift.title ? cleanTitle(gift.title) : `Gift #${identifier}`;
    const imageUrl = await getGiftThumbnailUrl(client, identifier, gift.sticker);
    return { identifier, name, icon: pickIcon(name), imageUrl, stars: Number(gift.stars ?? 0) };
  });
}

/**
 * Polls the official resale marketplace for a specific collection (gift_id).
 * This is the discovery mechanism: `payments.getResaleStarGifts` returns
 * currently-listed collectible instances of that base gift, including the
 * current owner — everything the offer flow needs.
 */
export async function getResaleListings(tenantId: string, giftIdentifier: string): Promise<ResaleListing[]> {
  const client = await ensureConnected(tenantId);

  const result = await withRetry(
    () =>
      client.invoke(
        new Api.payments.GetResaleStarGifts({
          giftId: bigInt(giftIdentifier),
          limit: 50,
          offset: "",
        })
      ),
    { label: "payments.getResaleStarGifts" }
  );

  const listings: ResaleListing[] = [];
  for (const gift of result.gifts) {
    if (!(gift instanceof Api.StarGiftUnique) || !gift.ownerId) continue;
    const ownerId =
      "userId" in gift.ownerId
        ? String(gift.ownerId.userId)
        : "channelId" in gift.ownerId
          ? String(gift.ownerId.channelId)
          : "";
    const resellStars = gift.resellAmount?.find((a) => a instanceof Api.StarsAmount)?.amount ?? null;

    listings.push({
      slug: gift.slug,
      identifier: String(gift.giftId),
      name: cleanTitle(gift.title),
      num: gift.num,
      ownerId,
      ownerPeer: gift.ownerId,
      resellStars: resellStars != null ? Number(resellStars) : null,
    });
  }
  return listings;
}
