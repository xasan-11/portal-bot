import { Router, Request } from "express";
import { startLogin, submitLoginCode, submitLoginPassword, logout } from "../../telegram/auth";
import { isLoggedIn } from "../../telegram/client";
import { stopAutomation } from "../../automation/monitor";

const tenantOf = (req: Request) => req.tenant!;

export const authRouter = Router();

authRouter.get("/status", async (req, res) => {
  res.json({ connected: await isLoggedIn(tenantOf(req).tenantId) });
});

authRouter.post("/logout", async (req, res) => {
  try {
    const t = tenantOf(req);
    stopAutomation(t); // never leave monitoring running against a session we're about to kill
    await logout(t.tenantId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Akkauntdan chiqishda xatolik" });
  }
});

authRouter.post("/send-code", async (req, res) => {
  try {
    const { phoneNumber } = req.body as { phoneNumber?: string };
    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber talab qilinadi" });
    const result = await startLogin(tenantOf(req).tenantId, phoneNumber);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Kod yuborishda xatolik" });
  }
});

authRouter.post("/verify-code", async (req, res) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) return res.status(400).json({ error: "code talab qilinadi" });
    const result = await submitLoginCode(tenantOf(req).tenantId, code);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Kod noto'g'ri" });
  }
});

authRouter.post("/verify-password", async (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    if (!password) return res.status(400).json({ error: "password talab qilinadi" });
    const result = await submitLoginPassword(tenantOf(req).tenantId, password);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Parol noto'g'ri" });
  }
});
