import { useEffect, useState, useCallback } from "react";
import { api, AccountInfo, AutomationStatus, NftCatalogItem, Offer, Settings, Stats } from "../api";
import StatCard from "../components/StatCard";
import OffersTable from "../components/OffersTable";
import NftPicker from "../components/NftPicker";

function StatusLabel({ status }: { status: AutomationStatus }) {
  switch (status) {
    case "running":
      return <span className="text-success">🟢 Ishlayapti</span>;
    case "paused_spam":
      return <span className="text-warning">⏸ Pauzada — spam tekshirilmoqda</span>;
    case "paused_balance":
      return <span className="text-warning">⏸ Pauzada — balance kam</span>;
    default:
      return <span className="text-danger">🔴 To'xtatilgan</span>;
  }
}

function statusDescription(status: AutomationStatus): string {
  switch (status) {
    case "running":
      return "Monitoring faol — mos NFT topilsa avtomatik offer yuboriladi";
    case "paused_spam":
      return "Telegram spam cheklovi (PEER_FLOOD) aniqlandi. Monitoring background'da davom etmoqda, cheklov olib tashlangani aniqlanishi bilan avtomatik davom etadi.";
    case "paused_balance":
      return "Stars balansi yetarli emas. Monitoring background'da davom etmoqda, balance to'ldirilgani aniqlanishi bilan avtomatik davom etadi.";
    default:
      return "Monitoring to'xtatilgan";
  }
}

export default function Dashboard() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [catalog, setCatalog] = useState<NftCatalogItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingSelection, setSavingSelection] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const refresh = useCallback(async () => {
    const [acc, st, off, se] = await Promise.all([
      api.account(),
      api.stats(),
      api.offers(),
      api.settings(),
    ]);
    setAccount(acc);
    setStats(st);
    setOffers(off);
    setSettings(se);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!account?.connected) return;
    api.catalog().then(setCatalog).catch(() => setCatalog([]));
    api.selected().then((rows) => setSelected(new Set(rows.map((r) => r.nft_identifier))));
  }, [account?.connected]);

  async function toggleAutomation() {
    if (!account) return;
    setToggling(true);
    try {
      if (account.running) {
        await api.stop();
      } else {
        await api.start();
      }
      await refresh();
    } finally {
      setToggling(false);
    }
  }

  function toggleNft(identifier: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(identifier)) next.delete(identifier);
      else next.add(identifier);
      return next;
    });
  }

  async function saveSelection() {
    setSavingSelection(true);
    try {
      const items = catalog
        .filter((c) => selected.has(c.identifier))
        .map((c) => ({ identifier: c.identifier, name: c.name }));
      await api.saveSelected(items);
    } finally {
      setSavingSelection(false);
    }
  }

  async function updateSetting(partial: Partial<Settings>) {
    const updated = await api.updateSettings(partial);
    setSettings(updated);
  }

  async function handleLogout() {
    if (!confirm("Telegram akkauntdan chiqishni tasdiqlaysizmi? Avtomatizatsiya to'xtatiladi.")) return;
    setLoggingOut(true);
    try {
      await api.logout();
      setCatalog([]);
      setSelected(new Set());
      await refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-base-800 bg-base-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎁</span>
            <div>
              <h1 className="font-extrabold tracking-tight text-lg leading-none">NFT OFFER BOT</h1>
              <p className="text-xs text-slate-500 mt-0.5">Collectible gift offer automation</p>
            </div>
          </div>
          <AccountBadge account={account} />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {!account?.connected && (
          <div className="card border-warning/30 bg-warning/5 flex items-center justify-between">
            <div>
              <p className="font-medium text-warning">Telegram akkaunt ulanmagan</p>
              <p className="text-sm text-slate-400 mt-0.5">
                Avtomatizatsiyani ishga tushirish uchun avval akkauntni ulang.
              </p>
            </div>
            <a href="/login" className="btn-primary shrink-0">
              🔐 Login qilish
            </a>
          </div>
        )}

        {account?.connected && (
          <section className="card flex items-center justify-between">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                👤 Account <span className="pill bg-success/15 text-success text-xs">🟢 Ulangan</span>
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {account.username ? `@${account.username}` : "—"} · ID:{" "}
                {account.telegramUserId ?? "—"}
              </p>
            </div>
            <button className="btn-danger shrink-0" onClick={handleLogout} disabled={loggingOut}>
              🔓 {loggingOut ? "Chiqilmoqda..." : "Akkauntni uzish"}
            </button>
          </section>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Found NFTs" value={stats?.foundNfts ?? 0} />
          <StatCard label="Matching NFTs" value={stats?.matchingNfts ?? 0} />
          <StatCard label="Offers sent" value={stats?.offersSent ?? 0} />
          <StatCard label="Accepted" value={stats?.accepted ?? 0} tone="success" />
          <StatCard label="Declined" value={stats?.declined ?? 0} tone="danger" />
          <StatCard label="Expired" value={stats?.expired ?? 0} tone="warning" />
          <StatCard label="Failed" value={stats?.failed ?? 0} tone="danger" />
          <StatCard label="Pending" value={stats?.pending ?? 0} tone="warning" />
        </section>

        <section className="card flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <StatusLabel status={account?.status ?? "stopped"} />
            </h2>
            <p className="text-sm text-slate-500 mt-1">{statusDescription(account?.status ?? "stopped")}</p>
          </div>
          <button
            className={account?.running ? "btn-danger" : "btn-primary"}
            onClick={toggleAutomation}
            disabled={!account?.connected || toggling}
          >
            {account?.running ? "⏹ Stop" : "▶️ Start"}
          </button>
        </section>

        <section className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">🖼 Selected NFTs</h2>
            <button className="btn-ghost text-sm !px-3 !py-1.5" onClick={saveSelection} disabled={savingSelection}>
              💾 {savingSelection ? "Saqlanmoqda..." : "Saqlash"}
            </button>
          </div>
          <NftPicker catalog={catalog} selected={selected} onToggle={toggleNft} />
        </section>

        {settings && (
          <section className="card">
            <h2 className="font-semibold mb-4">⚙️ Offer sozlamalari</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Field label="Stars">
                <input
                  className="input"
                  type="number"
                  value={settings.stars}
                  onChange={(e) => updateSetting({ stars: Number(e.target.value) })}
                />
              </Field>
              <Field label="Duration (seconds)">
                <select
                  className="input"
                  value={settings.duration}
                  onChange={(e) => updateSetting({ duration: Number(e.target.value) })}
                >
                  {[21600, 43200, 86400, 129600, 172800, 259200].map((s) => (
                    <option key={s} value={s}>
                      {s / 3600}h ({s})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Monitoring interval (s)">
                <input
                  className="input"
                  type="number"
                  value={settings.monitoringIntervalSeconds}
                  onChange={(e) =>
                    updateSetting({ monitoringIntervalSeconds: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Auto Offer">
                <button
                  className={settings.autoOffer ? "btn-primary w-full" : "btn-ghost w-full"}
                  onClick={() => updateSetting({ autoOffer: !settings.autoOffer })}
                >
                  {settings.autoOffer ? "🟢 ON" : "🔴 OFF"}
                </button>
              </Field>
              <Field label="Max owner level">
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={settings.maxOwnerLevel}
                  onChange={(e) => updateSetting({ maxOwnerLevel: Number(e.target.value) })}
                />
              </Field>
              <Field label="Max owner NFT count">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={settings.maxOwnerNftCount}
                  onChange={(e) => updateSetting({ maxOwnerNftCount: Number(e.target.value) })}
                />
              </Field>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Offer faqat owner darajasi ≤ Max owner level VA owner'ning collectible NFT soni &lt; Max
              owner NFT count bo'lganda yuboriladi.
            </p>
          </section>
        )}

        <section className="card">
          <h2 className="font-semibold mb-4">Offers</h2>
          <OffersTable offers={offers} />
        </section>
      </main>
    </div>
  );
}

function AccountBadge({ account }: { account: AccountInfo | null }) {
  const connected = account?.connected ?? false;
  return (
    <div className="flex items-center gap-2">
      <span className={`pill ${connected ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
        {connected ? "🟢 Ulangan" : "🔴 Ulanmagan"}
      </span>
      {account?.username && <span className="text-sm text-slate-400">@{account.username}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-slate-500 mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
