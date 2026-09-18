function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a Telegram API call with retry + exponential backoff.
 * FloodWaitError (RPC error FLOOD_WAIT_X) carries a `.seconds` field telling us
 * exactly how long to wait — we honor that instead of guessing.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const floodSeconds = extractFloodWaitSeconds(err);
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) break;

      const waitMs = floodSeconds != null ? floodSeconds * 1000 : baseDelayMs * 2 ** attempt;
      console.warn(
        `[retry] ${options.label ?? "telegram call"} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${waitMs}ms`,
        floodSeconds != null ? `(FLOOD_WAIT ${floodSeconds}s)` : ""
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function extractFloodWaitSeconds(err: unknown): number | null {
  if (err && typeof err === "object") {
    const anyErr = err as { seconds?: number; errorMessage?: string; message?: string };
    if (typeof anyErr.seconds === "number") return anyErr.seconds;
    const msg = anyErr.errorMessage ?? anyErr.message ?? "";
    const match = /FLOOD_WAIT_(\d+)/.exec(msg);
    if (match) return Number(match[1]);
  }
  return null;
}
