import { Markup } from "telegraf";
import { env } from "../config/env";
import { NftCatalogItem } from "../telegram/gifts";
import { AutomationStatus } from "../automation/monitor";

export function mainMenu(connected: boolean, running: boolean) {
  return Markup.inlineKeyboard([
    [Markup.button.url("🔐 Login qilish", `${env.webPublicUrl}/login`)],
    [Markup.button.callback("🖼 NFT tanlash", "menu:nft")],
    [
      running
        ? Markup.button.callback("⏹ To'xtash", "menu:stop")
        : Markup.button.callback("▶️ Boshlash", "menu:start"),
    ],
    [Markup.button.callback("⚙️ Sozlamalar", "menu:settings")],
  ]);
}

export function statusLine(connected: boolean): string {
  return connected ? "🟢 Telegram akkaunt ulangan" : "🔴 Telegram akkaunt ulanmagan";
}

export function automationStatusLine(status: AutomationStatus): string {
  switch (status) {
    case "running":
      return "🟢 Ishlayapti";
    case "paused_spam":
      return "⏸ Pauzada — spam tekshirilmoqda";
    case "paused_balance":
      return "⏸ Pauzada — balance kam";
    default:
      return "🔴 To'xtatilgan";
  }
}

export function nftSelectionKeyboard(catalog: NftCatalogItem[], selected: Set<string>) {
  const rows = catalog.map((item) => {
    const mark = selected.has(item.identifier) ? "☑" : "☐";
    return [
      Markup.button.callback(`${mark} ${item.icon} ${item.name}`, `nft:toggle:${item.identifier}`),
    ];
  });
  rows.push([Markup.button.callback("💾 Saqlash", "nft:save")]);
  rows.push([Markup.button.callback("⬅️ Orqaga", "menu:home")]);
  return Markup.inlineKeyboard(rows);
}

export function settingsKeyboard(autoOffer: boolean) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        autoOffer ? "🟢 Auto Offer: ON" : "🔴 Auto Offer: OFF",
        "settings:toggle_auto"
      ),
    ],
    [Markup.button.url("🌐 Dashboardda batafsil sozlash", env.webPublicUrl)],
    [Markup.button.callback("⬅️ Orqaga", "menu:home")],
  ]);
}
