import { useState } from "react";
import { api } from "../api";

type Stage = "phone" | "code" | "password" | "done";

export default function Login() {
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [codeDigits, setCodeDigits] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const formattedCode = codeDigits.split("").join(".");

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.sendCode(phone.trim());
      setStage("code");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.verifyCode(codeDigits);
      setCodeDigits(""); // never linger in memory longer than necessary
      if (result.step === "password_needed") {
        setStage("password");
      } else {
        setStage("done");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.verifyPassword(password);
      setPassword("");
      setStage("done");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">🔐</div>
          <h1 className="text-xl font-bold tracking-tight">Telegram akkauntni ulash</h1>
          <p className="text-slate-400 text-sm mt-1">
            Ma'lumotlar hech qachon serverga yoki bazaga saqlanmaydi
          </p>
        </div>

        <div className="card">
          {stage === "phone" && (
            <form onSubmit={submitPhone} className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1.5 block">Telefon raqami</label>
                <input
                  className="input"
                  placeholder="+998 90 123 45 67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              {error && <ErrorBox message={error} />}
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? "Yuborilmoqda..." : "Kod yuborish"}
              </button>
            </form>
          )}

          {stage === "code" && (
            <form onSubmit={submitCode} className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1.5 block">
                  Telegramga yuborilgan kod
                </label>
                <input
                  className="input text-center text-lg tracking-widest font-mono"
                  placeholder="1.2.3.4.5"
                  value={formattedCode}
                  onChange={(e) => setCodeDigits(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  autoFocus
                  required
                  inputMode="numeric"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  12345, 1.2.3.4.5 yoki 1 2 3 4 5 — barchasi qabul qilinadi
                </p>
              </div>
              {error && <ErrorBox message={error} />}
              <button className="btn-primary w-full" disabled={busy || codeDigits.length < 4}>
                {busy ? "Tekshirilmoqda..." : "Tasdiqlash"}
              </button>
            </form>
          )}

          {stage === "password" && (
            <form onSubmit={submitPassword} className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1.5 block">
                  2-Step Verification (2FA) parol
                </label>
                <input
                  className="input"
                  type="password"
                  placeholder="Parolingiz"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              {error && <ErrorBox message={error} />}
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? "Tekshirilmoqda..." : "Kirish"}
              </button>
            </form>
          )}

          {stage === "done" && (
            <div className="text-center py-4 space-y-2">
              <div className="text-3xl">✅</div>
              <p className="font-medium text-success">
                Telegram akkaunt muvaffaqiyatli ulandi
              </p>
              <a href="/" className="btn-ghost inline-flex mt-3">
                Dashboardga o'tish
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm px-3 py-2">
      {message}
    </div>
  );
}
