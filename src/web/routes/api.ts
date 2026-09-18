import { Router } from "express";
import { isLoggedIn } from "../../telegram/client";
import { getGlobalGiftCatalog } from "../../telegram/gifts";
import { getConnectedUser } from "../../database/repositories/usersRepo";
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
} from "../../automation/monitor";
import { listOffers, countByStatus as countOffersByStatus } from "../../database/repositories/offersRepo";
import { countAll as countAllNfts } from "../../database/repositories/nftsRepo";

export const apiRouter = Router();

apiRouter.get("/account", async (_req, res) => {
  const connected = await isLoggedIn();
  const user = getConnectedUser();
  res.json({
    connected,
    running: isAutomationRunning(),
    status: getAutomationStatus(),
    telegramUserId: user?.telegram_user_id ?? null,
    username: user?.username ?? null,
  });
});

apiRouter.get("/nfts/catalog", async (_req, res) => {
  try {
    if (!(await isLoggedIn())) return res.json([]);
    res.json(await getGlobalGiftCatalog());
  } catch (err: any) {
    console.error("[nfts/catalog] failed to fetch gift catalog:", err);
    res.status(500).json({ error: err?.message ?? "Katalogni olishda xatolik" });
  }
});

apiRouter.get("/nfts/selected", (_req, res) => {
  res.json(listSelectedNfts());
});

apiRouter.post("/nfts/selected", (req, res) => {
  const { items } = req.body as { items?: { identifier: string; name: string }[] };
  if (!Array.isArray(items)) return res.status(400).json({ error: "items massiv bo'lishi kerak" });
  try {
    saveSelection(items);
    res.json({ ok: true, count: items.length });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Saqlashda xatolik" });
  }
});

apiRouter.get("/settings", (_req, res) => {
  res.json(getSettings());
});

apiRouter.post("/settings", (req, res) => {
  try {
    res.json(updateSettings(req.body ?? {}));
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Sozlamalarni saqlashda xatolik" });
  }
});

apiRouter.post("/automation/start", (_req, res) => {
  if (listSelectedNfts().length === 0) {
    return res.status(400).json({ error: "Avval kamida bitta NFT tanlang" });
  }
  startAutomation();
  res.json({ running: true, status: getAutomationStatus() });
});

apiRouter.post("/automation/stop", (_req, res) => {
  stopAutomation();
  res.json({ running: false, status: getAutomationStatus() });
});

apiRouter.get("/offers", (_req, res) => {
  res.json(listOffers());
});

apiRouter.get("/stats", (_req, res) => {
  const found = countAllNfts();
  res.json({
    foundNfts: found,
    matchingNfts: found, // monitoring only ever scans selected collections
    offersSent: countOffersByStatus("pending") + countOffersByStatus("accepted") + countOffersByStatus("declined") + countOffersByStatus("expired") + countOffersByStatus("failed"),
    accepted: countOffersByStatus("accepted"),
    declined: countOffersByStatus("declined"),
    expired: countOffersByStatus("expired"),
    failed: countOffersByStatus("failed"),
    pending: countOffersByStatus("pending"),
  });
});
