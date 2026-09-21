import { ReactNode, useEffect, useState } from "react";
import { api, ApiError } from "../api";

type State = "checking" | "ok" | "denied" | "no-telegram" | "error";

/**
 * Blocks the whole app until the backend confirms this Telegram user is
 * approved. The check itself is server-side (initData HMAC + approved list);
 * this component only turns the 401/403 responses into a readable screen.
 */
export default function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    api
      .account()
      .then(() => setState("ok"))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setState("denied");
        else if (err instanceof ApiError && err.status === 401) setState("no-telegram");
        else setState("error");
      });
  }, []);

  if (state === "ok") return <>{children}</>;

  const message: Record<Exclude<State, "ok">, string> = {
    checking: "Yuklanmoqda…",
    denied: "⛔️ Sizga bu botdan foydalanishga ruxsat berilmagan. Admin bilan bog'laning.",
    "no-telegram": "Bu ilovani Telegram bot ichidagi tugma orqali oching.",
    error: "Serverga ulanib bo'lmadi. Keyinroq qayta urinib ko'ring.",
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center text-slate-300">
      <p className="max-w-sm">{message[state]}</p>
    </div>
  );
}
