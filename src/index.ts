import "./database/db"; // initializes schema on import
import { createBot } from "./bot/bot";
import { startWebServer } from "./web/server";
import { migrateLegacySessionFile } from "./telegram/sessionStore";
import { restoreSessions } from "./tenant";
import { env } from "./config/env";
import { setAdminNotifier } from "./automation/monitor";

async function main() {
  if (!env.adminTelegramId) {
    console.warn("[access] ADMIN_TELEGRAM_ID is not set — nobody is admin, so nobody can be approved or use the bot");
  }
  migrateLegacySessionFile(); // old single-account session -> admin's per-user session
  startWebServer();

  const bot = createBot();
  setAdminNotifier(async (text) => {
    if (env.adminTelegramId) await bot.telegram.sendMessage(env.adminTelegramId, text);
  });
  bot
    .launch()
    .then(() => console.log("[bot] Telegram control bot started"))
    .catch((err) => {
      console.error(
        "[bot] Failed to start control bot (check TELEGRAM_BOT_TOKEN) — web dashboard stays up regardless:",
        err?.message ?? err
      );
    });

  restoreSessions().catch((err) => console.error("[startup] session restore failed:", err));

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
