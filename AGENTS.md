# Nextday — Agent Guide

## What this repo is

A local-server PWA dashboard (Fastify + TypeScript, Node.js ESM). No external build step for the frontend. Designed to run on a Raspberry Pi or Android tablet. Shows tomorrow's calendar, weather, and school schedule (Wilma) on a single screen. The server runs in the **Europe/Helsinki** timezone.

## Repo layout

```
src/
  index.ts              — server entry: wires routes, schedules calendar refresh
  types.ts              — shared TypeScript interfaces (DayResponse, AppConfig, …)
  routes/
    config.ts           — GET/POST /api/config, reads/writes config.json
    day.ts              — GET /api/day, aggregates all sources for a date
    meta.ts             — GET /api/meta, returns student list and version
  sources/
    calendar.ts         — iCal fetch + in-memory/disk cache (calendar-cache.json)
    weather.ts          — Open-Meteo integration (Pirkkala, Finland coordinates)
    wilma.ts            — Wilma student schedule, homework, exams
public/                 — static frontend (HTML/JS/CSS), served as-is
dist/                   — compiled output (tsc), not edited directly
config.json             — runtime config: calendars, Wilma creds, UI prefs
calendar-cache.json     — persisted iCal event cache (regenerated on each refresh)
```

## Development

```bash
npm install
npm run dev      # tsx watch — hot-reloads on save, port 3000
npm run build    # tsc → dist/
npm start        # runs dist/index.js
```

No tests. Verify behaviour by running `npm run dev` and hitting the API routes or checking the browser UI.

## Key conventions

- **ESM throughout**: all imports use `.js` extensions (even for `.ts` sources). Do not add `.ts` extensions.
- **No frontend build**: `public/` is vanilla HTML/JS/CSS. Do not introduce a bundler.
- **Config persistence**: runtime config lives in `config.json` at the repo root; calendar cache in `calendar-cache.json`. Both are written at runtime — do not commit them.
- **Timezone**: all calendar times are stored as UTC ISO strings internally and displayed in `Europe/Helsinki`. Every date calculation must be timezone-explicit — never rely on `new Date(y, m, d, ...)` (local time); use `Date.UTC(...)` or `Intl.DateTimeFormat` with an explicit `timeZone` option instead.
- **Source errors**: each data source returns `T | SourceError`. Never throw across the aggregation boundary in `day.ts`; return `{ error: true, message }` instead.
- **Default date**: `/api/day` with no `?date=` param returns tomorrow in Helsinki time, calculated by `getTomorrowHelsinki()` in `day.ts`.

## Timezone pitfalls — read before touching calendar.ts

The server runs in **Europe/Helsinki**. This interacts badly with two dependencies:

### 1. rrule (via node-ical) — recurring events

`node-ical` builds rrule rule strings with `DTSTART;TZID=Europe/Helsinki:<local-time>`. The rrule library's `dateInTimeZone(date, targetTZ)` corrects occurrence times by computing `offset = targetTZ - serverTZ`. When both are `Europe/Helsinki`, the offset is **zero** and no conversion happens — occurrences come back with the Helsinki local time packed into UTC fields instead of real UTC.

**The fix (already in place):** `correctRruleOccurrence()` in `calendar.ts` detects `serverTZ === rruleTzid` and does the UTC conversion itself: it extracts the local time from the occurrence's UTC fields and converts via `Intl` arithmetic. Do not remove or simplify this function.

### 2. `new Date(y, m, d)` — local-time construction

`new Date(year, month, day, ...)` creates a date in the server's local timezone (Helsinki). On a Helsinki server, `new Date(2026, 3, 30)` is `2026-04-29T21:00:00Z`, not `2026-04-30T00:00:00Z`. Use `Date.UTC(year, month, day, ...)` whenever you want a UTC midnight. All existing date arithmetic in the codebase already follows this rule.

### 3. node-ical all-day events

For all-day events, node-ical calls `new Date(y, m, d)` (local time) then the rrule handler adds back the timezone offset for east-of-UTC servers. The result is stored using `d.getUTCDate()` etc. This is correct for the rrule path, but fragile. When touching all-day event handling, verify that the cached `start` string is `YYYY-MM-DD` (not the previous day).

## Calendar cache

`calendar-cache.json` is an array of `CachedFeed` objects. Each feed contains `NormalizedEvent[]` where:
- `start`/`end` for timed events: UTC ISO string (`2026-04-07T12:45:00.000Z`)
- `start`/`end` for all-day events: `YYYY-MM-DD` string

The cache is refreshed on server startup and every 30 minutes. Deleting `calendar-cache.json` forces a clean fetch on next startup. If a feed fails to refresh, the stale in-memory data is kept (not written to disk).

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/day?date=YYYY-MM-DD` | Aggregate response: weather + calendar + kids. `date` defaults to tomorrow in Helsinki. |
| GET | `/api/config` | Read `config.json` |
| POST | `/api/config` | Write `config.json`, then re-initialises Wilma and triggers calendar refresh |
| GET | `/api/meta` | `{ students, version, status }` |

## Adding a new data source

1. Create `src/sources/<name>.ts` exporting `fetch<Name>(date: string): Promise<T | SourceError>`.
2. Add the type(s) to `src/types.ts` and extend `DayResponse`.
3. Call it inside `src/routes/day.ts` alongside the existing sources (use `Promise.race` with a timeout).
4. Render the result in `public/index.html`.

## Environment / secrets

Secrets (Wilma credentials, iCal URLs) are stored in `config.json`, managed through the `/api/config` endpoint. There is no `.env` file; do not re-introduce one.
