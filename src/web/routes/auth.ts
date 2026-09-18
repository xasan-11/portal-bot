import { Router } from "express";
import { startLogin, submitLoginCode, submitLoginPassword, logout } from "../../telegram/auth";
import { isLoggedIn } from "../../telegram/client";
import { stopAutomation } from "../../automation/monitor";

export const authRouter = Router();

authRouter.get("/status", async (_req, res) => {
  res.json({ connected: await isLoggedIn() });
});

authRouter.post("/logout", async (_req, res) => {
  try {
    stopAutomation(); // never leave monitoring running against a session we're about to kill
    await logout();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Akkauntdan chiqishda xatolik" });
  }
});

authRouter.post("/send-code", async (req, res) => {
  try {
    const { phoneNumber } = req.body as { phoneNumber?: string };
    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber talab qilinadi" });
    const result = await startLogin(phoneNumber);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Kod yuborishda xatolik" });
  }
});

authRouter.post("/verify-code", async (req, res) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) return res.status(400).json({ error: "code talab qilinadi" });
    const result = await submitLoginCode(code);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Kod noto'g'ri" });
  }
});

authRouter.post("/verify-password", async (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    if (!password) return res.status(400).json({ error: "password talab qilinadi" });
    const result = await submitLoginPassword(password);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Parol noto'g'ri" });
  }
});
