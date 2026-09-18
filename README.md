# NFT Offer Bot

Telegram collectible gift (NFT) offer automation: a control bot (Telegram Bot API) +
a web dashboard (React) drive an MTProto client that watches Telegram's
official collectible-gift resale marketplace and sends purchase offers (in
Stars) on the gift models you choose.

## ⚠️ Read this before you rely on it

This project was built against Telegram's **official, currently documented**
MTProto methods for collectible gifts and gift purchase offers
(`payments.getStarGifts`, `payments.getResaleStarGifts`,
`payments.sendStarGiftOffer`, `payments.resolveStarGiftOffer`). There is no
invented or reverse-engineered "Portal" API involved — everything goes through
Telegram itself, using your own account.

One real risk remains, and you should know about it before running this in
anger:

- **Feature availability.** Gift purchase offers are a newer Telegram feature.
  Whether it's available depends on your Telegram client/server version and
  region rollout. If `payments.sendStarGiftOffer` comes back with
  `STARGIFT_OFFER_NOT_ALLOWED`, that's Telegram telling you the feature isn't
  available to this account yet — not a bug in this code.

### Why `teleproto`, not `telegram` (GramJS)

The archived `telegram` npm package (GramJS) declares MTProto layer 198,
which predates gift resale/offers (introduced at layer 220; current is 225).
This isn't just "a few methods missing" — Telegram's server tailors object
formats to whatever layer the client declares during connection, so an old
layer means the server silently sends back **old-shape objects for every
type that changed since**, including ones that ripple far outside gifts (we
initially tried hand-patching just the gift-related constructors and it
broke on `channel#1c32b11c`, a core type unrelated to gifts, because the
patchwork left the declared layer at 198). Bumping the declared layer without
also updating every constructor that changed since is a losing game — so
this project uses `teleproto` (`telegram`'s actively-maintained fork)
instead, which declares layer 229 and has full native, coherent support for
`payments.getStarGifts`, `payments.getResaleStarGifts`,
`payments.sendStarGiftOffer`, and `payments.resolveStarGiftOffer` — verified
live against a real account (catalog fetch and resale listing both
confirmed working end-to-end). No raw-TL patching needed.

Nothing here talks to any third-party marketplace (Portals Market, Tonnel,
etc.) — if that's actually what you meant by "Portal", that would require a
separate, unofficial, reverse-engineered integration, which was intentionally
left out per the request to never invent non-official APIs.

## How it works

- **Control bot** (`src/bot`) — Telegram Bot API bot (Telegraf) with the
  `/start` menu. It never asks for your phone number, login code, or 2FA
  password in chat — "🔐 Login qilish" just opens the web login page.
- **MTProto client** (`src/telegram`) — logs in as *your* Telegram user account
  (the one that owns/trades the gifts), using the official gifts/offers API.
  The session is encrypted at rest (AES-256-GCM) and stored only in
  `data/telegram.session`, never in the database.
- **NFT catalog** (`src/telegram/gifts.ts#getGlobalGiftCatalog`) — calls
  `payments.getStarGifts`, Telegram's platform-wide catalog of every gift
  model, filtered to ones that can become collectibles (`upgrade_stars` set).
  This is **not** your personal collection — it's every model that could ever
  show up on the resale market, which is what you actually need to build a
  monitoring filter from. Each entry's preview image is downloaded from the
  gift's sticker thumbnail (`src/telegram/thumbnails.ts`) and disk-cached,
  served statically at `/gift-thumbnails`.
- **Automation** (`src/automation/monitor.ts`) — polls
  `payments.getResaleStarGifts` for each gift model you selected, matches
  against your filter list, checks the `offers` table for duplicate
  protection (one offer per collectible instance, and one offer per owner —
  ever — regardless of that offer's outcome), checks the owner meets the
  configured level/NFT-count limits (`src/telegram/ownerChecks.ts`), and
  sends an offer (125 ⭐, 6h expiry by default) for anything that clears all
  of that. It only offers on listings that appeared on Telegram's resale
  market within the last minute: Telegram has no listing timestamp, so this
  is inferred from polling — the first scan after Start only records what's
  already listed, then a listing counts only if the bot first saw it <60s
  ago (`NEW_LISTING_WINDOW_MS`). Listings that appear while paused/stopped
  are never offered on.
- **Owner eligibility** (`src/telegram/ownerChecks.ts`) — before offering,
  checks the owner's Telegram "Level" (`users.getFullUser` →
  `userFull.stars_rating.level`, per
  [the Stars API docs](https://core.telegram.org/api/stars#star-rating)) and
  their collectible gift count (`payments.getSavedStarGifts`, counting
  `StarGiftUnique` instances, capped at the configured threshold so large
  collections don't require full pagination). Both limits are editable from
  the dashboard's Settings section. If the level can't be determined, the
  owner is skipped rather than assumed eligible.
- **"Offer" folder** (`src/telegram/folders.ts`) — every owner an offer is
  sent to is added to a chat folder named "Offer"
  (`messages.getDialogFilters` / `messages.updateDialogFilter` — the official
  [folders API](https://core.telegram.org/api/folders)), and removed again
  if the offer is declined or expires. There's no incremental add/remove-peer
  method in the API, so this reads the current folder, edits its peer list,
  and writes the whole thing back each time; if the folder would end up with
  zero members it's deleted instead (Telegram rejects an empty include list).
  **If you already have a folder named exactly "Offer" for something else,
  this will start managing it too** — rename one of them if that's not what
  you want.
- **Spam/balance auto-pause** (`src/automation/monitor.ts`) — automation has
  four states, not just on/off: `running`, `paused_spam`, `paused_balance`,
  `stopped`. Hitting Telegram's `PEER_FLOOD` or `BALANCE_TOO_LOW` error while
  sending an offer pauses *new sends only* — discovery/logging keeps running
  in the background — and recovery is automatic:
  - **Balance** has a real official check, `payments.getStarsStatus`
    ([docs](https://core.telegram.org/method/payments.getStarsStatus)): every
    ~90s while paused, it re-reads your Stars balance and resumes as soon as
    it covers the configured offer amount. Genuinely harmless, no side
    effects.
  - **Spam has no equivalent.** Checked
    [`api/errors.json`](https://core.telegram.org/api/errors.json) directly —
    `PEER_FLOOD` isn't listed against any method there, and there's no
    documented "am I still flood-restricted" query anywhere in the official
    API. A generic harmless call (e.g. `help.getConfig`) wouldn't actually
    tell you anything, since `PEER_FLOOD` gates specific peer-contacting
    actions, not reads. The only honest way to know is to retry that exact
    kind of action — so every ~90s, if discovery has found a
    legitimately-eligible new offer candidate, exactly **one** real send is
    attempted as the test (not a fabricated action — it's an offer you
    already intended to send). Success resumes normal operation
    immediately; `PEER_FLOOD` again keeps it paused for another cycle. If no
    eligible candidate exists that cycle, there's nothing to test and it
    simply waits for the next one.
  - Stopping (⏹) always fully stops both sending and background monitoring,
    regardless of pause state — pausing is automatic/internal, Stop is
    always a deliberate full halt.
- **Web dashboard** (`client/`) — React + Tailwind, dark mode. Login page at
  `/login`, dashboard at `/`. Deployable either as its own static service
  (see "Deploying to Railway" below, `VITE_API_URL` points it at the
  backend) or served directly by the backend's Express app when built into
  the same deployment — in local dev, Vite serves it separately and proxies
  API calls back to Express.

```text
src/
  bot/          Telegram control bot (menus, callbacks)
  telegram/     MTProto client, login flow, gifts/offers API calls
  automation/   The monitoring/offer loop
  database/     SQLite schema + repositories
  web/          Express API + routes consumed by the dashboard
  config/       Environment loading
client/         React + TypeScript + Tailwind dashboard (own workspace, own deploy)
```

## Setup

### 1. Get your API ID / API HASH

1. Go to <https://my.telegram.org> and log in with the phone number of the
   account that will trade the gifts.
2. Open "API development tools".
3. Create an app (any name/platform is fine) and copy **App api_id** and
   **App api_hash**.

### 2. Get a bot token

Talk to [@BotFather](https://t.me/BotFather) on Telegram, `/newbot`, and copy
the token it gives you. This bot is only the control panel — it never touches
your account's gifts directly.

### 3. Configure environment

```bash
cp .env.example .env
cp client/.env.example client/.env
```

Root `.env`, fill in:

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` — from step 1
- `TELEGRAM_BOT_TOKEN` — from step 2
- `SESSION_ENCRYPTION_KEY` — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

`client/.env` — leave `VITE_API_URL` empty for local dev (Vite's proxy
handles it); only needed when the dashboard is deployed separately from the
backend (see "Deploying to Railway").

### 4. Install & run

```bash
npm install
npm run dev
```

This starts the Express API on `:3001`, the Telegram control bot, and the
Vite dev server for the dashboard on `:3000`. Open:

- **Dashboard:** http://localhost:3000
- **Login page:** http://localhost:3000/login

### 5. Connect your account

Either open the bot in Telegram and tap **🔐 Login qilish**, or go straight to
`http://localhost:3000/login`. Enter your phone number, then the verification
code Telegram sends you (dots/spaces are fine — `1.2.3.4.5` and `12345` both
work), then your 2FA password if you have one enabled. None of these three
values are ever written to the database, logs, or browser storage — the code
and password exist only in server memory for the duration of the login
request.

To disconnect later, use **🔓 Akkauntni uzish** in the dashboard's Account
card (shown once connected). This calls the official
[`auth.logOut`](https://core.telegram.org/method/auth.logOut) — which
invalidates the session server-side, so the old session string wouldn't work
even if it weren't deleted — stops automation first if it was running, then
clears the local encrypted session file and disconnects the account (its
data is kept, not deleted — see "Database" below). You'll need to go through
phone/code/(2FA) again to reconnect.

### 6. Pick NFTs and go

In the dashboard (or the bot's "🖼 NFT tanlash" menu), select which
collectible gift types — from Telegram's full gift catalog, not your personal
collection — the automation should hunt for on the resale market, save, then
hit **▶️ Start**.

## Security notes

- Phone number, verification code, and 2FA password are **never** persisted —
  not to SQLite, not to disk, not to logs.
- The MTProto session string is the only long-lived credential; it's
  AES-256-GCM encrypted with `SESSION_ENCRYPTION_KEY` and lives only at
  `data/telegram.session` (git-ignored).
- `.env` (both root and `client/`), `data/`, and `*.session` are all
  git-ignored.
- All Telegram calls go through a retry/backoff wrapper
  (`src/telegram/retry.ts`) that honors `FLOOD_WAIT_*` errors instead of
  hammering the API.
- Stopping automation (⏹) only stops sending *new* offers — offers already
  sent are left to resolve normally (accept/decline/expire) and are never
  auto-canceled.

## Database

SQLite (via `better-sqlite3`) at `data/app.db`, schema in
`src/database/schema.sql`: `users`, `app_state`, `selected_nfts`, `nfts`,
`offers`, `settings`. Duplicate protection is enforced in
`src/database/repositories/offersRepo.ts#hasBlockingOffer` — once any offer
row exists for a given collectible's identifier, it's never offered on again.

**Data is scoped per Telegram account.** `selected_nfts`, `nfts`, `offers`,
and `settings` all carry a `user_id`, and every repository function reads it
from `app_state.current_user_id` (set on login, cleared on logout — see
`src/database/repositories/appStateRepo.ts`) rather than trusting a global
table. `users` itself is a permanent historical record — logging the same
account back in after logging out resumes with the same `id` and therefore
the same data, while a *different* account gets a clean slate. If you
upgrade from a version of this project that predated this (single shared,
unscoped tables), `src/database/migrate.ts` runs automatically on first
startup: it moves every pre-existing row into a synthetic `__legacy__`
account bucket — never onto whichever account happens to be connected at
migration time — so old data is preserved and inspectable but never bleeds
into a real account's view. This is a one-time, idempotent migration; it
does nothing on an already-migrated or brand-new database.

## Deploying to Railway

**Recommended: two separate Railway services from this one repo** — a
persistent backend (API + bot + automation) and a static frontend (the
built dashboard). They deploy, scale, and restart independently, and the
frontend doesn't need a long-running Node process at all once it's built.
Both `railway.json` (repo root, for the backend) and `client/railway.json`
(for the frontend) are provided; whether or not Railway auto-applies a
service's config file, **set the fields directly in that service's
Settings tab too** — it's the one thing you fully control from the
dashboard, so treat it as the source of truth.

### Service 1 — Backend

| Setting | Value |
|---|---|
| Root Directory | *(leave empty — repo root)* |
| Build Command | `npm run build` |
| Start Command | `npm start` |

**Environment variables:**

| Variable | Value |
|---|---|
| `TELEGRAM_API_ID` | from my.telegram.org |
| `TELEGRAM_API_HASH` | from my.telegram.org |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `SESSION_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATABASE_PATH` | `/data/app.db` (see volume step below) |
| `SESSION_FILE_PATH` | `/data/telegram.session` |
| `WEB_PUBLIC_URL` | the **frontend's** Railway domain, e.g. `https://your-frontend.up.railway.app` — this is what CORS allows and what the bot's "🔐 Login qilish" button links to |
| `NIXPACKS_NODE_VERSION` | `20` (see below — belt-and-suspenders alongside `engines.node`) |

Don't set `PORT` or `WEB_PORT` — Railway injects `PORT` itself, and
`src/config/env.ts` prefers it automatically (`server.ts` also binds to
`0.0.0.0` explicitly, required to be reachable inside a container, not just
from localhost).

**Node version matters here, concretely, not just as a best practice**:
`better-sqlite3` ships prebuilt native binaries per Node major version, and
compiles from source (via node-gyp) if none matches — which failed on
Railway when Nixpacks picked Node 24 (confirmed cause: the previous
`engines.node` was `">=20.0.0"`, an open range, but Nixpacks only recognizes
an exact major like `"20"` or `"20.x"` — anything else falls through to
whatever it defaults to). `better-sqlite3`'s locked version
(`11.10.0`) has confirmed prebuilt binaries for Node 20 but not 24, so
pinning to 20 avoids native compilation entirely rather than depending on
build tools (python/make/g++) being present in the image. Both `engines.node`
(root and `client/package.json`) and `.nvmrc` are already pinned to `20` in
this repo; setting `NIXPACKS_NODE_VERSION=20` as well costs nothing and sits
at the top of Nixpacks' own precedence order (env var > `engines.node` >
`.nvmrc`), so it can't be defeated by a future accidental change to either
file.

**Add a persistent volume**, mount path `/data` (any path works as long as
`DATABASE_PATH`/`SESSION_FILE_PATH` above point at it) — the SQLite database
and the Telegram session file **must** survive restarts and redeploys, or
every deploy logs you out and wipes your data. The gift-thumbnail cache
(`src/telegram/thumbnails.ts`) isn't a separate variable — it's derived from
`DATABASE_PATH`'s directory, so it lands on the same volume automatically.

The control bot uses long polling (not a webhook), so it needs no extra
port or route beyond the one Railway exposes for the API.

### Service 2 — Frontend (dashboard)

| Setting | Value |
|---|---|
| Root Directory | `client` |
| Build Command | `npm run build` |
| Start Command | `npm start` |

**Environment variables:**

| Variable | Value |
|---|---|
| `VITE_API_URL` | the **backend's** Railway domain, e.g. `https://your-backend.up.railway.app` (no trailing slash) |
| `NIXPACKS_NODE_VERSION` | `20` (this service has no native deps, but pinned for consistency — see the backend section above for why) |

`VITE_API_URL` is inlined into the JS bundle **at build time** — changing it
requires a rebuild (a redeploy triggers one; just restarting the service
does not pick up a changed value).

`npm start` here runs `node start.js`
([`serve`](https://www.npmjs.com/package/serve) in single-page-app mode,
`-s dist`), which reads `PORT` in Node rather than relying on
shell-specific syntax like `${PORT:-3000}` — that form quietly breaks under
some shells (confirmed: it does under Windows `cmd.exe`), so this avoids
depending on Railway's exact shell behavior. `serve -s` also handles the
SPA fallback so `/login` works on a direct link or hard refresh.

### Why this split (vs. one combined service)

`src/web/server.ts` *can* serve the built dashboard itself (checks whether
`client/dist/index.html` exists and serves it same-origin with the API if
so) — useful for local production-mode testing (`npm run build && npm run
build:client && npm start` from the repo root serves everything from one
port with zero extra config, no `VITE_API_URL` needed). But on Railway,
running it as one service means every redeploy rebuilds and restarts the
dashboard together with the bot/automation process, and a frontend-only
change pays for a full backend rebuild. Splitting them means the static
frontend can redeploy in seconds independently, and the backend's restart
policy (`ON_FAILURE`, retried) only ever concerns the process that actually
needs to stay running continuously.

### Deploy

Railway builds each service via Nixpacks (Node detected from
`package.json` + `package-lock.json`; `engines.node` pins `>=20`). After the
first deploy, open the **frontend's** domain's `/login` to connect your
Telegram account (same flow as local setup, step 5 above) — the session then
persists on the backend's volume across future deploys.
