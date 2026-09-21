import { Telegraf, Context, MiddlewareFn } from "telegraf";
import { env } from "../config/env";
import { isLoggedIn } from "../telegram/client";
import { getGlobalGiftCatalog, NftCatalogItem } from "../telegram/gifts";
import { listSelectedNfts, saveSelection } from "../database/repositories/selectedNftsRepo";
import { getSettings, updateSettings } from "../database/repositories/settingsRepo";
import { isAutomationRunning, getAutomationStatus, startAutomation, stopAutomation } from "../automation/monitor";
import {
  isAdmin,
  isApproved,
  addApprovedUser,
  removeApprovedUser,
  listApprovedUsers,
} from "../database/repositories/approvedUsersRepo";
import { tenantFor, revokeUser, listConnectedAccounts } from "../tenant";
import { getStarsBalance } from "../telegram/balance";
import { parsePostLink, sendPaidReaction, UserFacingError } from "../telegram/paidReactions";
import { mainMenu, cancelKeyboard, starsAccountKeyboard, statusLine, automationStatusLine, nftSelectionKeyboard, settingsKeyboard } from "./keyboards";

interface NftEditState {
  catalog: NftCatalogItem[];
  selected: Set<string>;
}

// Keyed by Telegram user id — each user edits their own selection.
const nftEditState = new Map<number, NftEditState>();

const NOT_APPROVED_TEXT = "⛔️ Sizga bu botdan foydalanishga ruxsat berilmagan. Kirish uchun admin bilan bog'laning.";

/** Admin-only gate (owner_only): refuses everyone except ADMIN_TELEGRAM_ID. */
const adminOnly: MiddlewareFn<Context> = async (ctx, next) => {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.reply("⛔️ Bu buyruq faqat admin uchun.");
    return;
  }
  return next();
};

/**
 * Global gate (approved_only): registered before every handler, so no
 * command, button press or message reaches any feature unless the sender is
 * the admin or on the approved list.
 */
const approvedOnly: MiddlewareFn<Context> = async (ctx, next) => {
  const id = ctx.from?.id;
  if (isApproved(id)) return next();
  const text = `${NOT_APPROVED_TEXT}\n\nSizning ID: ${id ?? "—"}`;
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery(NOT_APPROVED_TEXT, { show_alert: true });
    else await ctx.reply(text);
  } catch (err) {
    console.error("[bot] failed to send access-denied reply:", err);
  }
};

/** Main menu; the "⭐ Stars" button is added only for the admin. */
function menu(ctx: Context, connected: boolean, running: boolean) {
  return mainMenu(connected, running, isAdmin(ctx.from?.id));
}

/**
 * Admin-only "⭐ Stars" flow: pick a connected account -> show its balance ->
 * amount -> post link -> send a paid reaction from that account.
 * One in-progress flow per admin; cleared on cancel, error or success.
 */
type StarsFlow =
  | { step: "amount"; tenantId: string; balance: number }
  | { step: "link"; tenantId: string; balance: number; count: number };
const starsFlow = new Map<number, StarsFlow>();

/** Parses a positive integer Telegram user id; null if it isn't one. */
function parseUserId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,15}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}

function commandArgs(ctx: Context): string[] {
  const text = (ctx.message && "text" in ctx.message ? ctx.message.text : "") ?? "";
  return text.trim().split(/\s+/).slice(1);
}

export function createBot(): Telegraf {
  const bot = new Telegraf(env.botToken);

  bot.use(approvedOnly);

  // ── Admin commands ─────────────────────────────────────────────────────
  bot.command("adduser", adminOnly, async (ctx) => {
    const [rawId, ...noteParts] = commandArgs(ctx);
    const id = parseUserId(rawId);
    if (id == null) {
      await ctx.reply("❗️ Noto'g'ri format. Namuna: /adduser 123456789 do'stim\nID faqat raqamlardan iborat bo'lishi kerak.");
      return;
    }
    addApprovedUser(id, ctx.from!.id, noteParts.join(" ") || null);
    await ctx.reply(`✅ Foydalanuvchi qo'shildi: ${id}`);
  });

  bot.command("removeuser", adminOnly, async (ctx) => {
    const id = parseUserId(commandArgs(ctx)[0]);
    if (id == null) {
      await ctx.reply("❗️ Noto'g'ri format. Namuna: /removeuser 123456789");
      return;
    }
    if (isAdmin(id)) {
      await ctx.reply("❗️ Adminni ro'yxatdan olib tashlab bo'lmaydi.");
      return;
    }
    const removed = removeApprovedUser(id);
    // Even if there was no row, make sure no session / automation is left behind.
    await revokeUser(id);
    await ctx.reply(removed ? `❌ Foydalanuvchi olib tashlandi: ${id}` : `ℹ️ ${id} ro'yxatda yo'q edi.`);
  });

  bot.command("users", adminOnly, async (ctx) => {
    const users = listApprovedUsers();
    if (users.length === 0) {
      await ctx.reply("Ruxsat etilgan foydalanuvchilar yo'q (admin har doim ruxsatli).");
      return;
    }
    const lines = users.map((u) => {
      const when = new Date(u.added_at * 1000).toISOString().slice(0, 16).replace("T", " ");
      return `• ${u.telegram_user_id} — ${when} UTC${u.note ? ` — ${u.note}` : ""}`;
    });
    await ctx.reply(`👥 Ruxsat etilgan foydalanuvchilar (${users.length}):\n\n${lines.join("\n")}`);
  });

  // ── Regular user features (all per-user) ───────────────────────────────
  const homeText = async (tenant: ReturnType<typeof tenantFor>) => {
    const connected = await isLoggedIn(tenant.tenantId);
    return {
      connected,
      text: `NFT OFFER BOT\n\n${statusLine(connected)}\n${automationStatusLine(getAutomationStatus(tenant))}`,
    };
  };

  bot.start(async (ctx) => {
    const tenant = tenantFor(ctx.from.id, ctx.from.username);
    const { connected, text } = await homeText(tenant);
    await ctx.reply(text, menu(ctx, connected, isAutomationRunning(tenant)));
  });

  bot.action("menu:home", async (ctx) => {
    await ctx.answerCbQuery();
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    const { connected, text } = await homeText(tenant);
    await ctx.editMessageText(text, menu(ctx, connected, isAutomationRunning(tenant)));
  });

  bot.action("menu:nft", async (ctx) => {
    await ctx.answerCbQuery();
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    if (!(await isLoggedIn(tenant.tenantId))) {
      await ctx.editMessageText(
        "🔴 Avval Telegram akkauntingizni ulang.",
        menu(ctx, false, isAutomationRunning(tenant))
      );
      return;
    }
    const catalog = await getGlobalGiftCatalog(tenant.tenantId);
    if (catalog.length === 0) {
      await ctx.editMessageText(
        "Gift katalogini olishda muammo yoki hozircha mos turlar topilmadi.",
        menu(ctx, true, isAutomationRunning(tenant))
      );
      return;
    }
    const currentlySelected = new Set(listSelectedNfts(tenant.userId).map((n) => n.nft_identifier));
    nftEditState.set(ctx.from!.id, { catalog, selected: currentlySelected });
    await ctx.editMessageText("Kerakli NFTlarni tanlang:", nftSelectionKeyboard(catalog, currentlySelected));
  });

  bot.action(/^nft:toggle:(.+)$/, async (ctx) => {
    const identifier = ctx.match[1];
    const state = nftEditState.get(ctx.from!.id);
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
    const state = nftEditState.get(ctx.from!.id);
    if (!state) {
      await ctx.answerCbQuery("Sessiya eskirgan, qaytadan oching");
      return;
    }
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    const items = state.catalog
      .filter((c) => state.selected.has(c.identifier))
      .map((c) => ({ identifier: c.identifier, name: c.name }));
    saveSelection(tenant.userId, items);
    nftEditState.delete(ctx.from!.id);
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `✅ ${items.length} ta NFT tanlandi`,
      menu(ctx, await isLoggedIn(tenant.tenantId), isAutomationRunning(tenant))
    );
  });

  bot.action("menu:start", async (ctx) => {
    await ctx.answerCbQuery();
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    if (!(await isLoggedIn(tenant.tenantId))) {
      await ctx.editMessageText(
        "🔴 Avval Telegram akkauntingizni ulang.",
        menu(ctx, false, isAutomationRunning(tenant))
      );
      return;
    }
    if (listSelectedNfts(tenant.userId).length === 0) {
      await ctx.editMessageText(
        "⚠️ Avval kamida bitta NFT tanlang (🖼 NFT tanlash).",
        menu(ctx, true, isAutomationRunning(tenant))
      );
      return;
    }
    startAutomation(tenant);
    await ctx.editMessageText(
      "🟢 Offer avtomatizatsiyasi ishga tushdi",
      menu(ctx, true, true)
    );
  });

  bot.action("menu:stop", async (ctx) => {
    await ctx.answerCbQuery();
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    stopAutomation(tenant);
    await ctx.editMessageText(
      "🔴 Offer avtomatizatsiyasi to'xtatildi",
      menu(ctx, await isLoggedIn(tenant.tenantId), false)
    );
  });

  bot.action("menu:settings", async (ctx) => {
    await ctx.answerCbQuery();
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    const settings = getSettings(tenant.userId);
    const selected = listSelectedNfts(tenant.userId);
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
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    const settings = getSettings(tenant.userId);
    const updated = updateSettings(tenant.userId, { autoOffer: !settings.autoOffer });
    await ctx.answerCbQuery(`Auto Offer: ${updated.autoOffer ? "ON" : "OFF"}`);
    await ctx.editMessageReplyMarkup(settingsKeyboard(updated.autoOffer).reply_markup);
  });

  // ── ⭐ Stars (admin only) ──────────────────────────────────────────────
  const denyNonAdmin = async (ctx: Context): Promise<boolean> => {
    if (isAdmin(ctx.from?.id)) return false;
    await ctx.answerCbQuery("⛔️ Bu funksiya faqat admin uchun.", { show_alert: true });
    return true;
  };

  const showHome = async (ctx: Context, prefix?: string) => {
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    const { connected, text } = await homeText(tenant);
    await ctx.reply(prefix ? `${prefix}\n\n${text}` : text, menu(ctx, connected, isAutomationRunning(tenant)));
  };

  bot.action("stars:start", async (ctx) => {
    if (await denyNonAdmin(ctx)) return;
    await ctx.answerCbQuery();
    starsFlow.delete(ctx.from!.id);
    const accounts = await listConnectedAccounts();
    if (accounts.length === 0) {
      await ctx.editMessageText("Hech qanday akkaunt ulanmagan.", menu(ctx, false, false));
      return;
    }
    await ctx.editMessageText("Qaysi akkaunt ID'sini ishlatmoqchisiz?", starsAccountKeyboard(accounts));
  });

  bot.action("stars:cancel", async (ctx) => {
    if (await denyNonAdmin(ctx)) return;
    await ctx.answerCbQuery("Bekor qilindi");
    starsFlow.delete(ctx.from!.id);
    const tenant = tenantFor(ctx.from!.id, ctx.from!.username);
    const { connected, text } = await homeText(tenant);
    await ctx.editMessageText(text, menu(ctx, connected, isAutomationRunning(tenant)));
  });

  bot.action(/^stars:acc:(\d+)$/, async (ctx) => {
    if (await denyNonAdmin(ctx)) return;
    await ctx.answerCbQuery();
    const tenantId = ctx.match[1];
    // Only accounts that are really connected can be picked (the button list could be stale).
    if (!(await listConnectedAccounts()).some((a) => a.tenantId === tenantId)) {
      starsFlow.delete(ctx.from!.id);
      await ctx.editMessageText("❌ Bu akkaunt endi ulanmagan. Qaytadan boshlang.", menu(ctx, false, false));
      return;
    }
    const balance = await getStarsBalance(tenantId);
    if (balance == null) {
      starsFlow.delete(ctx.from!.id);
      await ctx.editMessageText("❌ Balansni olib bo'lmadi. Qaytadan urinib ko'ring.", menu(ctx, false, false));
      return;
    }
    starsFlow.set(ctx.from!.id, { step: "amount", tenantId, balance });
    await ctx.editMessageText(
      `Akkaunt: ${tenantId}\nBalans: ${balance} ⭐\n\nNechta Stars sarflamoqchisiz?`,
      cancelKeyboard()
    );
  });

  // Free-text input for the flow. Only ever reacts to the admin with an active flow.
  bot.on("text", async (ctx, next) => {
    const flow = isAdmin(ctx.from.id) ? starsFlow.get(ctx.from.id) : undefined;
    if (!flow || ctx.message.text.startsWith("/")) return next();
    const text = ctx.message.text.trim();

    if (flow.step === "amount") {
      const count = /^\d{1,7}$/.test(text) ? Number(text) : 0;
      if (count < 1) {
        await ctx.reply("❗️ Musbat butun son kiriting (masalan 500).", cancelKeyboard());
        return;
      }
      if (count > flow.balance) {
        await ctx.reply(`❗️ Balans yetarli emas (${flow.balance} ⭐). Kamroq son kiriting.`, cancelKeyboard());
        return;
      }
      starsFlow.set(ctx.from.id, { step: "link", tenantId: flow.tenantId, balance: flow.balance, count });
      await ctx.reply(
        "Qaysi postga? Post havolasini yuboring (masalan https://t.me/kanal_nomi/123)",
        cancelKeyboard()
      );
      return;
    }

    const link = parsePostLink(text);
    if (!link) {
      await ctx.reply("❗️ Havola noto'g'ri. Namuna: https://t.me/kanal_nomi/123", cancelKeyboard());
      return;
    }
    starsFlow.delete(ctx.from.id); // whatever happens next, the flow is over (no double-spend on retry)
    try {
      await sendPaidReaction(flow.tenantId, link, flow.count);
      const newBalance = await getStarsBalance(flow.tenantId);
      await showHome(
        ctx,
        `✅ ${flow.tenantId} orqali ${text} ga ${flow.count} ⭐ reaksiya yuborildi. Yangi balans: ${newBalance ?? "—"} ⭐`
      );
    } catch (err) {
      const reason = err instanceof UserFacingError ? err.message : "Kutilmagan xatolik yuz berdi.";
      if (!(err instanceof UserFacingError)) console.error("[stars] paid reaction failed:", err);
      await showHome(ctx, `❌ Yuborilmadi: ${reason}\n\nQayta boshlash uchun "⭐ Stars" ni bosing.`);
    }
  });

  return bot;
}
