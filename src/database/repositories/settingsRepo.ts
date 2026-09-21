import { db } from "../db";

export interface AutomationSettings {
  stars: number;
  duration: number;
  autoOffer: boolean;
  monitoringIntervalSeconds: number;
  /** Owner's Telegram stars-rating level must be <= this to receive an offer. */
  maxOwnerLevel: number;
  /** Owner's collectible gift count must be strictly less than this to receive an offer. */
  maxOwnerNftCount: number;
}

export const DEFAULT_SETTINGS: AutomationSettings = {
  stars: 125,
  duration: 21600,
  autoOffer: false,
  monitoringIntervalSeconds: 30,
  maxOwnerLevel: 1,
  maxOwnerNftCount: 3,
};

const getStmt = db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?");
const setStmt = db.prepare(
  "INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
);

function getRaw(userId: number, key: string): string | undefined {
  const row = getStmt.get(userId, key) as { value: string } | undefined;
  return row?.value;
}

/** Settings are per-user; anything not yet saved falls back to the defaults. */
export function getSettings(userId: number): AutomationSettings {
  return {
    stars: Number(getRaw(userId, "stars") ?? DEFAULT_SETTINGS.stars),
    duration: Number(getRaw(userId, "duration") ?? DEFAULT_SETTINGS.duration),
    autoOffer: (getRaw(userId, "autoOffer") ?? String(DEFAULT_SETTINGS.autoOffer)) === "true",
    monitoringIntervalSeconds: Number(
      getRaw(userId, "monitoringIntervalSeconds") ?? DEFAULT_SETTINGS.monitoringIntervalSeconds
    ),
    maxOwnerLevel: Number(getRaw(userId, "maxOwnerLevel") ?? DEFAULT_SETTINGS.maxOwnerLevel),
    maxOwnerNftCount: Number(getRaw(userId, "maxOwnerNftCount") ?? DEFAULT_SETTINGS.maxOwnerNftCount),
  };
}

export function updateSettings(userId: number, partial: Partial<AutomationSettings>): AutomationSettings {
  const current = getSettings(userId);
  const next = { ...current, ...partial };
  setStmt.run(userId, "stars", String(next.stars));
  setStmt.run(userId, "duration", String(next.duration));
  setStmt.run(userId, "autoOffer", String(next.autoOffer));
  setStmt.run(userId, "monitoringIntervalSeconds", String(next.monitoringIntervalSeconds));
  setStmt.run(userId, "maxOwnerLevel", String(next.maxOwnerLevel));
  setStmt.run(userId, "maxOwnerNftCount", String(next.maxOwnerNftCount));
  return next;
}
