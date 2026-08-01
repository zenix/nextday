# Nextday — Agent Guide

## What this repo is

A local-server PWA dashboard (Fastify + TypeScript, Node.js ESM). No external build step for the frontend. Designed to run on a Raspberry Pi or Android tablet. Shows tomorrow's calendar, weather, school schedule (Wilma), and Finnish public holidays on a single screen. The server runs in the **Europe/Helsinki** timezone.

The whole dashboard sits behind a single shared passphrase (see "Authentication" below) — there is no per-user account system, this is a household appliance, not a multi-tenant app.

## Repo layout

```
src/
  index.ts              — server entry: TLS/bind config, plugin & hook wiring, boot sequence
  types.ts              — shared TypeScript interfaces (DayResponse, PublicConfig, SecretsConfig, …)
  auth/
    passphrase.ts        — scrypt hash/verify for the shared passphrase
    session.ts            — server-side session store (sessions.json), cookie issuance
    hook.ts                — global onRequest auth gate + allow-list of unauthenticated paths
  security/
    hostCheck.ts          — Host-header allow-list (DNS-rebinding defense)
    csrf.ts                 — double-submit CSRF check for state-changing routes
    headers.ts             — @fastify/helmet CSP + other security headers
  net/
    safeFetch.ts           — SSRF-guarded fetch: scheme/IP-range validation, redirect cap, size cap, timeout
  config/
    store.ts                — reads/writes config.json (public) and secrets.json (0600); one-shot legacy migration
  routes/
    auth.ts                  — POST /api/login, POST /api/logout, GET /api/session
    config.ts                — GET/POST /api/config (redacted), PUT /api/secrets (write-only)
    day.ts                    — GET /api/day, aggregates all sources for a date
  sources/
    calendar.ts               — iCal fetch + in-memory/disk cache (calendar-cache.json), keyed by calendar id
    holidays.ts                 — Finnish public holidays via Nager.Date API (holidays-cache.json)
    weather.ts                   — Open-Meteo integration (Pirkkala, Finland coordinates)
    wilma.ts                      — Wilma student schedule, homework, exams; caches logged-in clients per student
scripts/
  set-passphrase.ts              — interactive CLI to (re)set the login passphrase
public/                          — static frontend (HTML/JS/CSS), served as-is
  index.html                      — dashboard shell (auth-gated)
  app.js                          — all dashboard JS (extracted so CSP can be script-src 'self' with no inline handlers)
  login.html                      — self-contained login page (not auth-gated)
  fonts/inter-latin.woff2         — self-hosted font (no fonts.googleapis.com request)
dist/                             — compiled output (tsc), not edited directly
config.json                       — non-secret runtime config: calendar names/ids, UI prefs, allowedHosts
secrets.json                      — Wilma password, calendar iCal URLs, passphrase hash (mode 0600, gitignored)
sessions.json                     — active login sessions (mode 0600, gitignored)
calendar-cache.json                — persisted iCal event cache (regenerated on each refresh; no URLs in it)
holidays-cache.json                — persisted Finnish public holidays cache (4 years, fetch-once)
```

## Development

```bash
npm install
npm run set-passphrase   # required once — server refuses to start without it
npm run dev              # tsx watch — hot-reloads on save, port 3000 (127.0.0.1 by default)
npm run build             # tsc → dist/
npm start                  # runs dist/index.js
```

No automated tests beyond what's under `node:test` for the pure security helpers (URL/IP validation, `esc()`, passphrase hash/verify). Verify behaviour mostly by running `npm run dev` and hitting the API routes or checking the browser UI.

## Key conventions

- **ESM throughout**: all imports use `.js` extensions (even for `.ts` sources). Do not add `.ts` extensions.
- **No frontend build**: `public/` is vanilla HTML/JS/CSS. Do not introduce a bundler.
- **Config vs. secrets — never merge these back together**: `config.json` is safe to hand to any authenticated client as-is and is what `GET /api/config` mostly returns. `secrets.json` (Wilma password, calendar iCal URLs, passphrase hash) is server-only, mode `0600`, and must never appear in a response body — `GET /api/config` returns only derived booleans (`passwordSet`, `urlSet`) for it. If you add a new secret, put it in `SecretsConfig` (`src/types.ts`) and `secrets.json`, not `PublicConfig`.
- **Calendars are keyed by a stable `id`, not by URL.** The public config only ever holds `{id, name}`; the secret URL lives in `secrets.json`'s `calendarUrls[id]` and the on-disk calendar cache is keyed by `id` too, precisely so the secret URL is never written to a file or response that doesn't need it.
- **Every outbound fetch of a config-supplied or first-party URL goes through `src/net/safeFetch.ts`**, not the bare `fetch()`. It blocks loopback/private/link-local targets (SSRF), caps redirects, enforces a timeout, and caps response size.
- **Every route except the small allow-list in `src/auth/hook.ts` requires a session.** Any new route is auth-gated automatically since the hook is global; only add a path to the allow-list if it genuinely must be reachable pre-login (and think hard about why).
- **State-changing routes (POST/PUT) need the `requireCsrf` preHandler** from `src/security/csrf.ts`, and the frontend must send the `X-CSRF-Token` header it got from `/api/session`.
- **Frontend XSS discipline**: every value from an external source (calendar titles, Wilma data, holiday names, error messages) must go through `esc()` in `public/app.js` before being interpolated into an `innerHTML` template. No inline `onclick=`/`<script>` in HTML — the CSP is `script-src 'self'` with no `unsafe-inline`; wire up events in `app.js` via `addEventListener`/delegation instead.
- **Source errors**: each data source returns `T | SourceError`. Never throw across the aggregation boundary in `day.ts`; return `{ error: true, message }` instead.
- **Default date**: `/api/day` with no `?date=` param returns tomorrow in Helsinki time, calculated by `getTomorrowHelsinki()` in `day.ts`.
- **Don't log a secret URL or credential.** Errors from calendar fetches are logged as `err.constructor.name`, not the raw error object, because undici errors frequently stringify the failing URL — and for these feeds the URL is the secret.

## Timezone pitfalls — read before touching calendar.ts

The server runs in **Europe/Helsinki**. This interacts badly with two dependencies:

### 1. rrule (via node-ical) — recurring events

`node-ical` builds rrule rule strings with `DTSTART;TZID=Europe/Helsinki:<local-time>`. The rrule library's `dateInTimeZone(date, targetTZ)` corrects occurrence times by computing `offset = targetTZ - serverTZ`. When both are `Europe/Helsinki`, the offset is **zero** and no conversion happens — occurrences come back with the Helsinki local time packed into UTC fields instead of real UTC.

**The fix (already in place):** `correctRruleOccurrence()` in `calendar.ts` detects `serverTZ === rruleTzid` and does the UTC conversion itself: it extracts the local time from the occurrence's UTC fields and converts via `Intl` arithmetic. Do not remove or simplify this function.

### 2. `new Date(y, m, d)` — local-time construction

`new Date(year, month, day, ...)` creates a date in the server's local timezone (Helsinki). On a Helsinki server, `new Date(2026, 3, 30)` is `2026-04-29T21:00:00Z`, not `2026-04-30T00:00:00Z`. Use `Date.UTC(year, month, day, ...)` whenever you want a UTC midnight. All existing date arithmetic in the codebase already follows this rule.

### 3. node-ical all-day events

For all-day events, node-ical calls `new Date(y, m, d)` (local time) then the rrule handler adds back the timezone offset for east-of-UTC servers. The result is stored using `d.getUTCDate()` etc. This is correct for the rrule path, but fragile. When touching all-day event handling, verify that the cached `start` string is `YYYY-MM-DD` (not the previous day).

**Note on `node-ical`'s version:** it's pinned below its latest (`^0.20.1`) because bumping to fix a moderate transitive `uuid` advisory (`node-ical` → `0.27.1`) is a breaking change that could interact with the timezone workarounds above. If you do this upgrade, re-verify all three pitfalls by hand (an all-day event, a Europe/Helsinki-TZID recurring event, and a plain timed event) before merging.

## Calendar cache

`calendar-cache.json` is an array of `CachedFeed` objects, keyed by calendar **id** (not URL — the URL is a secret and must never land in this file). Each feed contains `NormalizedEvent[]` where:
- `start`/`end` for timed events: UTC ISO string (`2026-04-07T12:45:00.000Z`)
- `start`/`end` for all-day events: `YYYY-MM-DD` string

The cache is refreshed on server startup, every 30 minutes, and after any config/secrets save. Deleting `calendar-cache.json` forces a clean fetch on next startup. If a feed fails to refresh, the stale in-memory data is kept (not written to disk).

## Holiday cache

`holidays-cache.json` is a flat array of `PublicHoliday` objects (`{ date, name, localName }`). Fetched from `https://date.nager.at/api/v3/PublicHolidays/{year}/FI` for the current year and 3 following years. The fetch is skipped on subsequent startups if the current year is already in the cache. Deleting `holidays-cache.json` forces a re-fetch on next startup.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/login` | none | `{ passphrase }` → sets session cookie, returns `{ csrfToken }`. Per-IP throttled with exponential backoff. |
| POST | `/api/logout` | session + CSRF | Destroys the current session. |
| GET | `/api/session` | session | `{ csrfToken }` — for a page that loaded from an existing cookie without going through `/api/login` this visit. |
| GET | `/api/day?date=YYYY-MM-DD` | session | Aggregate response: weather + calendar + kids + holiday. `date` defaults to tomorrow in Helsinki. |
| GET | `/api/config` | session | Public config plus `passwordSet`/`urlSet` booleans — never a secret value. |
| POST | `/api/config` | session + CSRF | Writes `config.json` (public fields only), then re-initialises Wilma and triggers a calendar refresh. |
| PUT | `/api/secrets` | session + CSRF | Write-only. Omitted/empty fields mean "leave unchanged". Validates new calendar URLs through `safeFetch`'s SSRF checks before saving. |
| GET | `/api/meta` | session | `{ students, version, status }` |

## Adding a new data source

1. Create `src/sources/<name>.ts` exporting `fetch<Name>(date: string): Promise<T | SourceError>`. Use `safeFetch` from `src/net/safeFetch.ts` for any outbound HTTP call.
2. Add the type(s) to `src/types.ts` and extend `DayResponse`.
3. Call it inside `src/routes/day.ts` alongside the existing sources (use `Promise.race` with a timeout).
4. Render the result in `public/app.js`, escaping every interpolated value with `esc()`.

## Environment / secrets

- **Passphrase**: set via `npm run set-passphrase`, stored (scrypt hash + salt) in `secrets.json`. The server will not bind without one configured.
- **Wilma credentials, calendar iCal URLs**: entered through Settings, stored only in `secrets.json` (mode `0600`, gitignored). `GET /api/config` never returns them.
- **`NEXTDAY_HOST`** (default `127.0.0.1`), **`NEXTDAY_PORT`** (default `3000`), **`NEXTDAY_TLS_CERT`** / **`NEXTDAY_TLS_KEY`** (optional, enables HTTPS and the `Secure` cookie flag) — read once at boot in `src/index.ts`.
- There is no `.env` file; do not re-introduce one.
