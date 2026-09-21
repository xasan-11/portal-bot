import { Router, Request } from "express";
import { isLoggedIn } from "../../telegram/client";
import { getGlobalGiftCatalog } from "../../telegram/gifts";
import { getUserByTelegramId } from "../../database/repositories/usersRepo";
import {
  listSelectedNfts,
  saveSelection,
} from "../../database/repositories/selectedNftsRepo";
import { getSettings, updateSettings } from "../../database/repositories/settingsRepo";
import {
  isAutomationRunning,
  getAutomationStatus,
  startAutomation,
  stopAutomation,
  TenantCtx,
} from "../../automation/monitor";
import { listOffers, countByStatus as countOffersByStatus } from "../../database/repositories/offersRepo";
import { countAll as countAllNfts } from "../../database/repositories/nftsRepo";

export const apiRouter = Router();

// Set by requireApprovedTelegramUser (server.ts) — always the Telegram-signed user.
const tenantOf = (req: Request): TenantCtx => req.tenant!;

apiRouter.get("/account", async (req, res) => {
  const t = tenantOf(req);
  const connected = await isLoggedIn(t.tenantId);
  const user = getUserByTelegramId(t.tenantId);
  res.json({
    connected,
    running: isAutomationRunning(t),
    status: getAutomationStatus(t),
    telegramUserId: user?.telegram_user_id ?? null,
    username: user?.username ?? null,
  });
});

apiRouter.get("/nfts/catalog", async (req, res) => {
  const t = tenantOf(req);
  try {
    if (!(await isLoggedIn(t.tenantId))) return res.json([]);
    res.json(await getGlobalGiftCatalog(t.tenantId));
  } catch (err: any) {
    console.error("[nfts/catalog] failed to fetch gift catalog:", err);
    res.status(500).json({ error: err?.message ?? "Katalogni olishda xatolik" });
  }
});

apiRouter.get("/nfts/selected", (req, res) => {
  res.json(listSelectedNfts(tenantOf(req).userId));
});

apiRouter.post("/nfts/selected", (req, res) => {
  const { items } = req.body as { items?: { identifier: string; name: string }[] };
  if (!Array.isArray(items)) return res.status(400).json({ error: "items massiv bo'lishi kerak" });
  try {
    saveSelection(tenantOf(req).userId, items);
    res.json({ ok: true, count: items.length });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Saqlashda xatolik" });
  }
});

apiRouter.get("/settings", (req, res) => {
  res.json(getSettings(tenantOf(req).userId));
});

apiRouter.post("/settings", (req, res) => {
  try {
    res.json(updateSettings(tenantOf(req).userId, req.body ?? {}));
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Sozlamalarni saqlashda xatolik" });
  }
});

apiRouter.post("/automation/start", async (req, res) => {
  const t = tenantOf(req);
  if (!(await isLoggedIn(t.tenantId))) {
    return res.status(400).json({ error: "Avval Telegram akkauntingizni ulang" });
  }
  if (listSelectedNfts(t.userId).length === 0) {
    return res.status(400).json({ error: "Avval kamida bitta NFT tanlang" });
  }
  startAutomation(t);
  res.json({ running: true, status: getAutomationStatus(t) });
});

apiRouter.post("/automation/stop", (req, res) => {
  const t = tenantOf(req);
  stopAutomation(t);
  res.json({ running: false, status: getAutomationStatus(t) });
});

apiRouter.get("/offers", (req, res) => {
  res.json(listOffers(tenantOf(req).userId));
});

apiRouter.get("/stats", (req, res) => {
  const { userId } = tenantOf(req);
  const found = countAllNfts(userId);
  const n = (s: Parameters<typeof countOffersByStatus>[1]) => countOffersByStatus(userId, s);
  res.json({
    foundNfts: found,
    matchingNfts: found, // monitoring only ever scans selected collections
    offersSent: n("pending") + n("accepted") + n("declined") + n("expired") + n("failed"),
    accepted: n("accepted"),
    declined: n("declined"),
    expired: n("expired"),
    failed: n("failed"),
    pending: n("pending"),
  });
});
