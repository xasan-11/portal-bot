import { Telegraf } from "telegraf";
import { env } from "../config/env";
import { isLoggedIn } from "../telegram/client";
import { getGlobalGiftCatalog, NftCatalogItem } from "../telegram/gifts";
import { listSelectedNfts, saveSelection } from "../database/repositories/selectedNftsRepo";
import { getSettings, updateSettings } from "../database/repositories/settingsRepo";
import { isAutomationRunning, getAutomationStatus, startAutomation, stopAutomation } from "../automation/monitor";
import { mainMenu, statusLine, automationStatusLine, nftSelectionKeyboard, settingsKeyboard } from "./keyboards";

interface NftEditState {
  catalog: NftCatalogItem[];
  selected: Set<string>;
}

const nftEditState = new Map<number, NftEditState>();

export function createBot(): Telegraf {
  const bot = new Telegraf(env.botToken);

  bot.start(async (ctx) => {
    const connected = await isLoggedIn();
    await ctx.reply(
      `NFT OFFER BOT\n\n${statusLine(connected)}\n${automationStatusLine(getAutomationStatus())}`,
      mainMenu(connected, isAutomationRunning())
    );
  });

  bot.action("menu:home", async (ctx) => {
    await ctx.answerCbQuery();
    const connected = await isLoggedIn();
    await ctx.editMessageText(
      `NFT OFFER BOT\n\n${statusLine(connected)}\n${automationStatusLine(getAutomationStatus())}`,
      mainMenu(connected, isAutomationRunning())
    );
  });

  bot.action("menu:nft", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await isLoggedIn())) {
      await ctx.editMessageText(
        "🔴 Avval Telegram akkauntingizni ulang.",
        mainMenu(false, isAutomationRunning())
      );
      return;
    }
    const catalog = await getGlobalGiftCatalog();
    if (catalog.length === 0) {
      await ctx.editMessageText(
        "Gift katalogini olishda muammo yoki hozircha mos turlar topilmadi.",
        mainMenu(true, isAutomationRunning())
      );
      return;
    }
    const currentlySelected = new Set(listSelectedNfts().map((n) => n.nft_identifier));
    nftEditState.set(ctx.chat!.id, { catalog, selected: currentlySelected });
    await ctx.editMessageText("Kerakli NFTlarni tanlang:", nftSelectionKeyboard(catalog, currentlySelected));
  });

  bot.action(/^nft:toggle:(.+)$/, async (ctx) => {
    const identifier = ctx.match[1];
    const state = nftEditState.get(ctx.chat!.id);
    if (!state) {
      await ctx.answerCbQuery("Sessiya eskirgan, qaytadan oching");
      return;
    }
    if (state.selected.has(identifier)) {
      state.selected.delete(identifier);
    } else {
      state.selected.add(identifier);
    }
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(nftSelectionKeyboard(state.catalog, state.selected).reply_markup);
  });

  bot.action("nft:save", async (ctx) => {
    const state = nftEditState.get(ctx.chat!.id);
    if (!state) {
      await ctx.answerCbQuery("Sessiya eskirgan, qaytadan oching");
      return;
    }
    const items = state.catalog
      .filter((c) => state.selected.has(c.identifier))
      .map((c) => ({ identifier: c.identifier, name: c.name }));
    saveSelection(items);
    nftEditState.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `✅ ${items.length} ta NFT tanlandi`,
      mainMenu(await isLoggedIn(), isAutomationRunning())
    );
  });

  bot.action("menu:start", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await isLoggedIn())) {
      await ctx.editMessageText(
        "🔴 Avval Telegram akkauntingizni ulang.",
        mainMenu(false, isAutomationRunning())
      );
      return;
    }
    if (listSelectedNfts().length === 0) {
      await ctx.editMessageText(
        "⚠️ Avval kamida bitta NFT tanlang (🖼 NFT tanlash).",
        mainMenu(true, isAutomationRunning())
      );
      return;
    }
    startAutomation();
    await ctx.editMessageText(
      "🟢 Offer avtomatizatsiyasi ishga tushdi",
      mainMenu(true, true)
    );
  });

  bot.action("menu:stop", async (ctx) => {
    await ctx.answerCbQuery();
    stopAutomation();
    await ctx.editMessageText(
      "🔴 Offer avtomatizatsiyasi to'xtatildi",
      mainMenu(await isLoggedIn(), false)
    );
  });

  bot.action("menu:settings", async (ctx) => {
    await ctx.answerCbQuery();
    const settings = getSettings();
    const selected = listSelectedNfts();
    const text = [
      "⚙️ Sozlamalar",
      "",
      `⭐ Stars: ${settings.stars}`,
      `⏱ Offer duration: ${settings.duration / 3600} soat`,
      `🔁 Monitoring interval: ${settings.monitoringIntervalSeconds}s`,
      `🤖 Auto Offer: ${settings.autoOffer ? "ON" : "OFF"}`,
      `📊 Max owner level: ${settings.maxOwnerLevel}`,
      `🖼 Max owner NFT soni: ${settings.maxOwnerNftCount}`,
      `🖼 Tanlangan NFTlar: ${selected.length > 0 ? selected.map((s) => s.nft_name).join(", ") : "—"}`,
    ].join("\n");
    await ctx.editMessageText(text, settingsKeyboard(settings.autoOffer));
  });

  bot.action("settings:toggle_auto", async (ctx) => {
    const settings = getSettings();
    const updated = updateSettings({ autoOffer: !settings.autoOffer });
    await ctx.answerCbQuery(`Auto Offer: ${updated.autoOffer ? "ON" : "OFF"}`);
    await ctx.editMessageReplyMarkup(settingsKeyboard(updated.autoOffer).reply_markup);
  });

  return bot;
}
