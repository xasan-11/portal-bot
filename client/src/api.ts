const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "So'rov bajarilmadi");
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
  catalog: () => request<NftCatalogItem[]>("/nfts/catalog"),
  selected: () => request<SelectedNft[]>("/nfts/selected"),
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

  offers: () => request<Offer[]>("/offers"),
  stats: () => request<Stats>("/stats"),
};
