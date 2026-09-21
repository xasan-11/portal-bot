// Set at build time (Vite inlines VITE_-prefixed vars). Unset = same-origin
// (local dev via Vite's proxy, or a single unified service) — set it to the
// backend's URL when the dashboard is deployed as its own separate service.
export const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const BASE = `${API_ORIGIN}/api`;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Telegram signs the user's identity into initData (only present when opened
// as a Mini App). The backend verifies its HMAC on every request and derives
// the user from it — the client never states who it is.
function telegramInitData(): string {
  return (window as any).Telegram?.WebApp?.initData ?? "";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `tma ${telegramInitData()}`,
      ...(options?.headers ?? {}),
    },
  });

  // A 200 with a non-JSON body (almost always this dashboard's own
  // index.html) means the request never reached the backend at all — most
  // likely VITE_API_URL is unset/stale in this build, so "/api/..." resolved
  // against this static site's own domain and got caught by its SPA
  // fallback instead of the real API. Treating that as success (silently
  // decoding to {}) is exactly what let bad data reach .map() calls
  // downstream, so it's surfaced as a real error here instead.
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError((data as { error?: string } | null)?.error ?? `So'rov bajarilmadi (HTTP ${res.status})`, res.status);
  }
  if (data === null) {
    throw new Error(
      "Backend'dan JSON javob kelmadi — VITE_API_URL to'g'ri sozlanganini va build shu qiymat bilan qayta yaratilganini tekshiring."
    );
  }
  return data as T;
}

export interface LoginStepResponse {
  step: "code_sent" | "password_needed" | "done";
  userId?: string;
  username?: string | null;
}

export interface NftCatalogItem {
  identifier: string;
  name: string;
  icon: string;
  imageUrl: string | null;
  stars: number;
}

export interface SelectedNft {
  id: number;
  nft_identifier: string;
  nft_name: string;
  enabled: number;
  created_at: string;
}

export type AutomationStatus = "stopped" | "running" | "paused_spam" | "paused_balance";

export interface AccountInfo {
  connected: boolean;
  running: boolean;
  status: AutomationStatus;
  telegramUserId: string | null;
  username: string | null;
}

export interface Settings {
  stars: number;
  duration: number;
  autoOffer: boolean;
  monitoringIntervalSeconds: number;
  maxOwnerLevel: number;
  maxOwnerNftCount: number;
}

export interface Offer {
  id: number;
  nft_identifier: string;
  owner_id: string;
  stars: number;
  duration: number;
  telegram_offer_id: string | null;
  status: "pending" | "accepted" | "declined" | "expired" | "failed";
  created_at: string;
  updated_at: string;
}

export interface Stats {
  foundNfts: number;
  matchingNfts: number;
  offersSent: number;
  accepted: number;
  declined: number;
  expired: number;
  failed: number;
  pending: number;
}

export const api = {
  sendCode: (phoneNumber: string) =>
    request<LoginStepResponse>("/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    }),
  verifyCode: (code: string) =>
    request<LoginStepResponse>("/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  verifyPassword: (password: string) =>
    request<LoginStepResponse>("/auth/verify-password", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  account: () => request<AccountInfo>("/account"),
  // imageUrl comes back as a path relative to the BACKEND ("/gift-thumbnails/x.webp"),
  // which only resolves correctly on its own if this dashboard is same-origin
  // with the API. Resolved to an absolute URL here so it still works when
  // deployed as a separate static service pointed at VITE_API_URL.
  catalog: () =>
    request<NftCatalogItem[]>("/nfts/catalog").then((items) =>
      (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        imageUrl: item.imageUrl ? `${API_ORIGIN}${item.imageUrl}` : null,
      }))
    ),
  selected: () =>
    request<SelectedNft[]>("/nfts/selected").then((rows) => (Array.isArray(rows) ? rows : [])),
  saveSelected: (items: { identifier: string; name: string }[]) =>
    request<{ ok: boolean; count: number }>("/nfts/selected", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  settings: () => request<Settings>("/settings"),
  updateSettings: (partial: Partial<Settings>) =>
    request<Settings>("/settings", { method: "POST", body: JSON.stringify(partial) }),

  start: () => request<{ running: boolean }>("/automation/start", { method: "POST" }),
  stop: () => request<{ running: boolean }>("/automation/stop", { method: "POST" }),

  offers: () => request<Offer[]>("/offers").then((rows) => (Array.isArray(rows) ? rows : [])),
  stats: () => request<Stats>("/stats"),
};
