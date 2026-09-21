import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Railway (and most PaaS providers) inject PORT and expect the app to bind
// to it; WEB_PORT remains for local dev where nothing else sets PORT.
const webPort = Number(process.env.PORT ?? process.env.WEB_PORT ?? 3001);

const databasePath = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/app.db");

export const env = {
  telegramApiId: Number(required("TELEGRAM_API_ID")),
  telegramApiHash: required("TELEGRAM_API_HASH"),
  botToken: required("TELEGRAM_BOT_TOKEN"),
  webPort,
  webPublicUrl: process.env.WEB_PUBLIC_URL ?? "http://localhost:3000",
  databasePath,
  sessionFilePath: path.resolve(process.cwd(), process.env.SESSION_FILE_PATH ?? "./data/telegram.session"),
  // Per-user encrypted sessions live in a `sessions/` directory next to the
  // legacy single-file path (so it sits on the same persistent volume).
  sessionsDir: path.join(path.dirname(path.resolve(process.cwd(), process.env.SESSION_FILE_PATH ?? "./data/telegram.session")), "sessions"),
  sessionEncryptionKey: required("SESSION_ENCRYPTION_KEY"),
  // Telegram user id of the admin (may manage /adduser, /removeuser, /users).
  // Never hardcoded — set ADMIN_TELEGRAM_ID on the backend service.
  adminTelegramId: Number(process.env.ADMIN_TELEGRAM_ID) || null,
  // Deliberately not a separate env var: lives next to the database, so
  // pointing DATABASE_PATH at a Railway volume (e.g. /data/app.db) carries
  // the thumbnail cache onto that same persistent volume automatically
  // instead of the container's ephemeral filesystem.
  giftThumbnailsDir: path.join(path.dirname(databasePath), "gift-thumbnails"),
};
