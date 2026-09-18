import fs from "node:fs";
import path from "node:path";
import type { TelegramClient } from "teleproto";
import type { Api } from "teleproto";
import { env } from "../config/env";

fs.mkdirSync(env.giftThumbnailsDir, { recursive: true });

const KNOWN_EXTENSIONS = ["jpg", "webp", "png"];

/**
 * Thumbnails come back in whatever format Telegram generated them in —
 * observed WebP in practice, not the JPEG the old Bot-API-era docs implied —
 * so the extension (and therefore the Content-Type express.static infers) is
 * picked from the actual file signature rather than assumed.
 */
function detectImageExtension(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (buffer.length >= 8 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  if (buffer.length >= 8 && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") {
    return "png";
  }
  return "jpg"; // unknown signature — assume the common case rather than fail
}

function findCachedFile(identifier: string): string | null {
  for (const ext of KNOWN_EXTENSIONS) {
    const candidate = path.join(env.giftThumbnailsDir, `${identifier}.${ext}`);
    if (fs.existsSync(candidate)) return `${identifier}.${ext}`;
  }
  return null;
}

/**
 * Downloads and disk-caches a small preview image for a gift's sticker
 * document, per https://core.telegram.org/api/files#downloading-files —
 * `upload.getFile` against the document's *smallest* thumbnail rather than
 * the full sticker (which is typically an animated .tgs/.webm, not a plain
 * raster image anyway). Returns a URL path served statically by the web
 * server (see src/web/server.ts), or null if no thumbnail exists or the
 * download fails — callers fall back to an emoji in that case, never an
 * error.
 */
export async function getGiftThumbnailUrl(
  client: TelegramClient,
  identifier: string,
  sticker: Api.TypeDocument
): Promise<string | null> {
  const cached = findCachedFile(identifier);
  if (cached) return `/gift-thumbnails/${cached}`;

  try {
    // Runtime supports a bare Document despite the narrower published type.
    const buffer = await client.downloadMedia(sticker as unknown as Api.TypeMessageMedia, {
      thumb: 0, // smallest available thumbnail — plenty for a small catalog icon
    });
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

    const ext = detectImageExtension(buffer);
    const fileName = `${identifier}.${ext}`;
    fs.writeFileSync(path.join(env.giftThumbnailsDir, fileName), buffer);
    return `/gift-thumbnails/${fileName}`;
  } catch (err) {
    console.error(`[thumbnails] failed to download thumbnail for gift ${identifier}:`, err);
    return null;
  }
}

/** Runs `fn` over `items` with at most `concurrency` in flight at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
