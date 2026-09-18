import "./database/db"; // initializes schema on import
import { createBot } from "./bot/bot";
import { startWebServer } from "./web/server";
import { isLoggedIn } from "./telegram/client";
import { registerOfferResolutionListener } from "./telegram/offers";

async function main() {
  startWebServer();

  const bot = createBot();
  bot
    .launch()
    .then(() => console.log("[bot] Telegram control bot started"))
    .catch((err) => {
      console.error(
        "[bot] Failed to start control bot (check TELEGRAM_BOT_TOKEN) — web dashboard stays up regardless:",
        err?.message ?? err
      );
    });

  try {
    if (await isLoggedIn()) {
      registerOfferResolutionListener();
    }
  } catch (err) {
    console.error("[telegram] Could not check login state at startup:", err);
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
