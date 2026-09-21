import { Api, utils } from "teleproto";
import { ensureConnected } from "./client";
import { withRetry } from "./retry";

/**
 * Telegram's account "Level" (profile progress bar, based on Stars spent on
 * gifts/messages/posts) — https://core.telegram.org/api/stars#star-rating.
 * Exposed via `users.getFullUser` -> `userFull.stars_rating` (a `StarsRating`
 * with a `level` field, "may be negative" per docs but in practice starts at
 * a low positive number for new/inactive accounts).
 *
 * Returns null if the level can't be determined (e.g. field absent) —
 * callers treat this conservatively as "unknown, don't offer" rather than
 * assuming a low level.
 */
export async function getOwnerLevel(tenantId: string, ownerPeer: Api.TypePeer): Promise<number | null> {
  const client = await ensureConnected(tenantId);
  try {
    const inputPeer = await client.getInputEntity(ownerPeer);
    const inputUser = utils.getInputUser(inputPeer);
    const result = await withRetry(
      () => client.invoke(new Api.users.GetFullUser({ id: inputUser })),
      { label: "users.getFullUser" }
    );
    const level = result.fullUser.starsRating?.level;
    return typeof level === "number" ? level : null;
  } catch (err) {
    console.error("[ownerChecks] failed to fetch owner level:", err);
    return null;
  }
}

/**
 * Counts the owner's collectible (unique) gifts via `payments.getSavedStarGifts`,
 * paginating only as far as needed to know whether the count reaches `capAt`
 * (we only ever need "< threshold", never the exact total). Like any data
 * about another account, this reflects what's publicly visible on their
 * profile — Telegram doesn't expose gifts a user has hidden, official API or
 * not.
 */
export async function countOwnerUniqueGifts(tenantId: string, ownerPeer: Api.TypePeer, capAt: number): Promise<number> {
  const client = await ensureConnected(tenantId);
  let count = 0;
  let offset = "";
  const MAX_PAGES = 10; // hard stop against runaway pagination for huge collections

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await withRetry(
      () =>
        client.invoke(
          new Api.payments.GetSavedStarGifts({
            peer: ownerPeer,
            offset,
            limit: 100,
          })
        ),
      { label: "payments.getSavedStarGifts (owner count)" }
    );

    for (const saved of result.gifts) {
      if (saved.gift instanceof Api.StarGiftUnique) count++;
    }

    if (count >= capAt) return count; // already disqualified — no need to keep paginating
    if (!result.nextOffset) return count; // exhausted all pages
    offset = result.nextOffset;
  }

  return count;
}

export interface OwnerEligibility {
  eligible: boolean;
  level: number | null;
  nftCount: number;
}

export async function checkOwnerEligibility(
  tenantId: string,
  ownerPeer: Api.TypePeer,
  limits: { maxOwnerLevel: number; maxOwnerNftCount: number }
): Promise<OwnerEligibility> {
  const level = await getOwnerLevel(tenantId, ownerPeer);
  if (level == null || level > limits.maxOwnerLevel) {
    return { eligible: false, level, nftCount: -1 };
  }

  const nftCount = await countOwnerUniqueGifts(tenantId, ownerPeer, limits.maxOwnerNftCount);
  const eligible = nftCount < limits.maxOwnerNftCount;
  return { eligible, level, nftCount };
}
