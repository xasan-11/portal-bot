import { errors } from "teleproto";

/**
 * Telegram errors that mean "this account is being rate-limited / spam
 * restricted" — as opposed to a one-off failure of a single call:
 *  - PEER_FLOOD: the account is spam-limited ("limited" state, @SpamBot)
 *  - FLOOD_WAIT_X / FLOOD_PREMIUM_WAIT_X / FLOOD_TEST_PHONE_WAIT_X: too many
 *    requests; X seconds must pass (short waits are absorbed by the library
 *    and never surface here, see floodSleepThreshold in client.ts)
 *  - USER_RESTRICTED: the account is restricted after spam reports
 * (There is no official list of "spam block" codes; these are the ones
 * Telegram documents / emits for this condition.)
 */
export function isSpamRestrictionError(err: unknown): boolean {
  if (err instanceof errors.PeerFloodError) return true;
  if (err instanceof errors.FloodError) return true; // FloodWaitError and friends
  if (err instanceof errors.UserRestrictedError) return true;
  const code = String((err as { errorMessage?: string } | null)?.errorMessage ?? "");
  return /FLOOD/.test(code) || code === "USER_RESTRICTED";
}

export function describeError(err: unknown): string {
  const e = err as { errorMessage?: string; seconds?: number; message?: string } | null;
  if (e?.errorMessage) return e.seconds != null && !/\d/.test(e.errorMessage) ? `${e.errorMessage} (${e.seconds}s)` : e.errorMessage;
  return e?.message ?? String(err);
}

/**
 * Seconds Telegram says to wait (FLOOD_WAIT_X / FLOOD_PREMIUM_WAIT_X, or the
 * `.seconds` field on FloodWaitError). null for errors with no stated wait
 * (PEER_FLOOD, USER_RESTRICTED).
 */
export function getFloodWaitSeconds(err: unknown): number | null {
  const e = err as { seconds?: number; errorMessage?: string; message?: string } | null;
  if (typeof e?.seconds === "number" && e.seconds > 0) return e.seconds;
  const m = /FLOOD\w*_WAIT_(\d+)/.exec(e?.errorMessage ?? e?.message ?? "");
  return m ? Number(m[1]) : null;
}
