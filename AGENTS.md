# Nextday — Agent Guide

## What this repo is

A local-server PWA dashboard (Fastify + TypeScript, Node.js ESM). No external build step for the frontend. Designed to run on a Raspberry Pi or Android tablet. Sources data from Wilma (school management), Google Calendar via iCal, and Open-Meteo weather.

## Repo layout

```
src/
  index.ts            — server entry: wires routes, schedules calendar refresh
  types.ts            — shared TypeScript interfaces (DayResponse, AppConfig, …)
  routes/
    config.ts         — GET/POST /api/config, reads/writes config.json
    day.ts            — GET /api/day/:date, aggregates all sources
    meta.ts           — GET /api/meta, returns student list and version
  sources/
    calendar.ts       — iCal fetch + in-memory/disk cache (calendar-cache.json)
    weather.ts        — Open-Meteo integration
    wilma.ts          — Wilma student schedule, homework, exams
public/               — static frontend (HTML/JS/CSS), served as-is
dist/                 — compiled output (tsc), not edited directly
config.json           — runtime config: calendars, Wilma creds, UI prefs
calendar-cache.json   — persisted iCal event cache
```

## Development

```bash
npm install
npm run dev      # tsx watch — hot-reloads on save, port 3000
npm run build    # tsc → dist/
npm start        # runs dist/index.js
```

There are no tests. Verify behaviour by running `npm run dev` and hitting the API routes manually or checking the browser UI.

## Key conventions

- **ESM throughout**: all imports use `.js` extensions (even for `.ts` sources). Do not add `.ts` extensions.
- **No frontend build**: `public/` is vanilla HTML/JS/CSS. Do not introduce a bundler.
- **Config persistence**: runtime config lives in `config.json` at the repo root; calendar cache in `calendar-cache.json`. Both are written at runtime — do not commit them with real credentials.
- **Timezone**: all calendar times are presented in `Europe/Helsinki`. Keep that consistent when adding new time-display logic.
- **Source errors**: each data source returns `T | SourceError` — never throw across the aggregation boundary; return `{ error: true, message }` instead.

## Adding a new data source

1. Create `src/sources/<name>.ts` exporting a `fetch<Name>(date: string): Promise<T | SourceError>` function.
2. Add the corresponding type(s) to `src/types.ts`.
3. Extend `DayResponse` in `types.ts` if the source contributes to the day endpoint.
4. Call the new function inside `src/routes/day.ts` alongside the existing sources.
5. Update `public/index.html` to render the new data.

## Environment / secrets

Secrets (Wilma credentials, iCal URLs) are stored in `config.json`, managed entirely through the `/api/config` endpoint — there is no `.env` file. Do not re-introduce `.env` support.
