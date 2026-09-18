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

export const env = {
  telegramApiId: Number(required("TELEGRAM_API_ID")),
  telegramApiHash: required("TELEGRAM_API_HASH"),
  botToken: required("TELEGRAM_BOT_TOKEN"),
  webPort: Number(process.env.WEB_PORT ?? 3001),
  webPublicUrl: process.env.WEB_PUBLIC_URL ?? "http://localhost:3000",
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/app.db"),
  sessionFilePath: path.resolve(process.cwd(), process.env.SESSION_FILE_PATH ?? "./data/telegram.session"),
  sessionEncryptionKey: required("SESSION_ENCRYPTION_KEY"),
  giftThumbnailsDir: path.resolve(process.cwd(), "./data/gift-thumbnails"),
};
