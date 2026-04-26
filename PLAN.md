# Nextday — Plan

A single-page dashboard + JSON API that shows, on demand, everything relevant for a given day: kids' school schedule, homework, exams (via Wilma), your Google Calendar events, and the weather forecast. Defaults to tomorrow; supports navigating forward and backward by day.

No LLM, no agent framework, no database — pure fetch-and-serve.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend | Node.js + TypeScript + Fastify | `wilmai` is a TS/Node lib — native use, no subprocess hacks |
| Wilma | `wilmai` npm library directly | Already wraps Pirkkala Wilma auth + data fetching |
| Calendar | `googleapis` npm package | Official Google API client |
| Weather | Open-Meteo (https://open-meteo.com) | Free, no API key, accurate for Finland |
| Frontend | Single plain HTML file + vanilla JS | No build step needed; dashboard is simple |
| Config | `.env` file + `dotenv` package | Credentials stay out of code |

---

## Project Structure

```
nextday/
├── src/
│   ├── index.ts              # Fastify server entry point
│   ├── routes/
│   │   └── day.ts            # GET /api/day route handler
│   ├── sources/
│   │   ├── wilma.ts          # Wilma data fetcher
│   │   ├── calendar.ts       # Google Calendar fetcher
│   │   └── weather.ts        # Open-Meteo fetcher
│   └── types.ts              # All shared TypeScript interfaces
├── public/
│   └── index.html            # Frontend (served as static asset)
├── .env                      # Secret credentials (gitignored)
├── .env.example              # Template — committed to repo
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## Package Setup

### `package.json`

```json
{
  "name": "nextday",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0",
    "googleapis": "^144.0.0",
    "wilmai": "latest",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^22.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

---

## Types (`src/types.ts`)

All interfaces used across sources and the route:

```typescript
export interface WeatherData {
  summary: string;        // Human-readable from WMO code
  tempMax: number;        // °C
  tempMin: number;        // °C
  precipitationMm: number;
  windKph: number;
  wmoCode: number;        // Raw WMO weather code (for icon mapping in frontend)
}

export interface CalendarEvent {
  time: string;           // "HH:MM" in Europe/Helsinki, or "All day"
  title: string;
  durationMinutes: number | null;  // null for all-day events
}

export interface ScheduleLesson {
  time: string;           // "HH:MM"
  subject: string;
  teacher: string;
}

export interface HomeworkItem {
  subject: string;
  description: string;
  dueDate: string;        // YYYY-MM-DD
}

export interface ExamItem {
  subject: string;
  date: string;           // YYYY-MM-DD
}

export interface KidData {
  name: string;
  schedule: ScheduleLesson[];
  homework: HomeworkItem[];   // All pending homework, not just due on this day
  exams: ExamItem[];          // Upcoming exams from today forward
}

export interface SourceError {
  error: true;
  message: string;
}

export interface DayResponse {
  date: string;           // YYYY-MM-DD — the requested date
  weather: WeatherData | SourceError;
  calendar: CalendarEvent[] | SourceError;
  kids: KidData[] | SourceError;
}
```

When a source fails, its field contains `{ error: true, message: "..." }` instead of its normal shape. The other sources are unaffected.

---

## API Route (`src/routes/day.ts`)

**`GET /api/day?date=YYYY-MM-DD`**

- `date` query param is optional. If omitted, defaults to tomorrow in `Europe/Helsinki` timezone.
- Validate format: must match `/^\d{4}-\d{2}-\d{2}$/` — return HTTP 400 if invalid.
- Fetch all three sources in parallel with `Promise.allSettled` (not `Promise.all` — one failure must not cancel the others).
- Each source call is wrapped in a `Promise.race` against a 10-second timeout that rejects with an error.
- Map settled results to the `DayResponse` shape: fulfilled → data, rejected → `SourceError`.

```typescript
// Computing "tomorrow" correctly in Helsinki time
function getTomorrowHelsinki(): string {
  const now = new Date();
  const helsinkiDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now); // gives YYYY-MM-DD
  const [y, m, d] = helsinkiDate.split('-').map(Number);
  const tomorrow = new Date(y, m - 1, d + 1);
  return tomorrow.toISOString().slice(0, 10);
}
```

---

## Server Entry (`src/index.ts`)

```typescript
import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dayRoute } from './routes/day.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

// Serve public/ as static assets (serves index.html at /)
app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

app.register(dayRoute);

app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
```

---

## Weather Source (`src/sources/weather.ts`)

### Open-Meteo endpoint logic

- If requested date is today or in the future (up to 16 days): use the **forecast** endpoint.
- If requested date is in the past: use the **archive** endpoint.

```
Forecast:
https://api.open-meteo.com/v1/forecast
  ?latitude=61.47
  &longitude=23.65
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode
  &timezone=Europe%2FHelsinki
  &forecast_days=16

Archive (past dates):
https://archive-api.open-meteo.com/v1/archive
  ?latitude=61.47
  &longitude=23.65
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode
  &timezone=Europe%2FHelsinki
  &start_date=YYYY-MM-DD
  &end_date=YYYY-MM-DD
```

Both return the same JSON shape:
```json
{
  "daily": {
    "time": ["2026-04-26", "2026-04-27", ...],
    "temperature_2m_max": [10.2, ...],
    "temperature_2m_min": [3.1, ...],
    "precipitation_sum": [0.5, ...],
    "wind_speed_10m_max": [18.3, ...],
    "weathercode": [3, ...]
  }
}
```

Find the index where `daily.time[i] === requestedDate`, then read the other arrays at that same index.

### WMO Weather Code → Summary string

```typescript
const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};
```

---

## Wilma Source (`src/sources/wilma.ts`)

### Library: `wilmai`

The `wilmai` package (https://github.com/aikarjal/wilmai) is a TypeScript/Node.js client. Install with `npm install wilmai`.

### Authentication

```typescript
import { WilmaClient } from 'wilmai';

const client = new WilmaClient({
  baseUrl: process.env.WILMA_BASE_URL!,   // https://pirkkala.inschool.fi
  username: process.env.WILMA_USERNAME!,
  password: process.env.WILMA_PASSWORD!,
  mfaSecret: process.env.WILMA_MFA_SECRET, // optional TOTP secret
});

// Login once at server startup and reuse the client.
// The client handles cookie-based session management internally.
// On 401, it automatically re-authenticates.
await client.login();
```

Create and login the client once at server startup (in `src/index.ts`), then pass the logged-in client instance to the wilma source function. Do not re-login on every request.

### Data fetching

The `wilmai` library returns data across all students associated with the account. Use `client.listStudents()` to get the list of kids, then for each student fetch:

```typescript
const overview = await client.overview.get();
// overview contains: schedule (lessons), homework, exams, grades
```

The `overview.get()` response includes lessons with dates. Filter:
- **Schedule**: lessons where `lesson.date === requestedDate`
- **Homework**: all homework items where `item.dueDate >= requestedDate` (show pending homework as of that day)
- **Exams**: all exam items where `exam.date >= requestedDate` (show upcoming exams)

The exact field names depend on the wilmai library's TypeScript types — check the library's exported interfaces when implementing. The CLI command `wilma schedule list --when tomorrow --json` can be used to inspect the actual data shape if needed.

### Multi-student handling

`WILMA_USERNAME` / `WILMA_PASSWORD` are the parent's credentials. The parent account has access to all their children. `client.listStudents()` returns all children. Iterate and fetch overview for each.

If the library requires switching student context per fetch, follow its API for that. Otherwise, `overview.get()` may already return data for all students — check the actual returned structure.

---

## Google Calendar Source (`src/sources/calendar.ts`)

### Auth setup (one-time)

Before implementing, the user must get a refresh token:

1. Create a project in Google Cloud Console
2. Enable the Google Calendar API
3. Create OAuth 2.0 credentials (Desktop app type)
4. Download the `client_id` and `client_secret`
5. Run this script once to get a refresh token:

```typescript
// scripts/get-google-token.ts — run once: npx tsx scripts/get-google-token.ts
import { google } from 'googleapis';
import * as readline from 'readline';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'  // desktop flow
);

const url = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.readonly'],
});

console.log('Open this URL:', url);
const rl = readline.createInterface({ input: process.stdin });
rl.question('Paste the code here: ', async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
  rl.close();
});
```

Store the printed refresh token in `.env`. After this the server uses it automatically.

### Fetching events

```typescript
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// For date "2026-04-27", query the full day in Helsinki time
const timeMin = new Date(`${date}T00:00:00+03:00`).toISOString();
const timeMax = new Date(`${date}T23:59:59+03:00`).toISOString();
// Note: Helsinki is UTC+3 in summer (EET+DST), UTC+2 in winter.
// Use the Intl API to compute the actual UTC offset for the given date
// rather than hardcoding +03:00.

const res = await calendar.events.list({
  calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
  timeMin,
  timeMax,
  singleEvents: true,
  orderBy: 'startTime',
});
```

Map each event:
- All-day events: `start.date` is set (no `start.dateTime`) → `time: "All day"`, `durationMinutes: null`
- Timed events: parse `start.dateTime`, format to `HH:MM` in `Europe/Helsinki`, compute duration from `end.dateTime - start.dateTime`

---

## Frontend (PWA)

A single HTML file plus Progressive Web App (PWA) assets to support installation on Windows, Linux, and Android. No external JS dependencies. All styling inline with `<style>`.

### PWA Assets

- `public/manifest.json`: Web app manifest for installation.
- `public/sw.js`: Service worker to cache the UI shell and make the app installable.
- `public/icons/`: App icons.

### State model

```javascript
let currentDate = readDateFromHash() || getTomorrow();  // YYYY-MM-DD string

function readDateFromHash() {
  const h = location.hash.slice(1);
  return /^\d{4}-\d{2}-\d{2}$/.test(h) ? h : null;
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
```

### Navigation

```javascript
function navigate(offset) {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  currentDate = d.toISOString().slice(0, 10);
  location.hash = currentDate;
  loadDay();
}

window.addEventListener('hashchange', () => {
  currentDate = readDateFromHash() || getTomorrow();
  loadDay();
});
```

Prev button calls `navigate(-1)`, Next calls `navigate(+1)`.

### Data loading

```javascript
async function loadDay() {
  showLoading();
  try {
    const res = await fetch(`/api/day?date=${currentDate}`);
    const data = await res.json();
    render(data);
  } catch (e) {
    showError('Failed to load data');
  }
}
```

### Layout structure (HTML)

```
┌──────────────────────────────────────────────────────┐
│  ← Prev   [Today] [Tomorrow]   MONDAY 27 APR   Next → │
├──────────────────────────────────────────────────────┤
│  ☁ Partly cloudy  12°/4°  💧 1.2mm  💨 18 km/h      │
├──────────────────────────────────────────────────────┤
│  YOUR DAY                                            │
│  09:00  Meeting  (60 min)                            │
│  14:00  Doctor's appointment  (30 min)               │
├──────────────────────────────────────────────────────┤
│  CHILD NAME 1                                        │
│  Schedule:  08:00 Math · 09:45 Finnish · ...         │
│  Homework:  Finnish — Read pages 12–15               │
│             Math — Exercises 3a–3e                   │
│  Exams:     History on 28 Apr                        │
├──────────────────────────────────────────────────────┤
│  CHILD NAME 2                                        │
│  ...                                                 │
└──────────────────────────────────────────────────────┘
```

### Loading and error states

- While loading: show a subtle spinner or "Loading..." text in the content area. Keep the header/nav visible.
- If a source has `{ error: true }`: show a small inline error notice ("Weather unavailable") in that section, don't hide the whole page.
- If the fetch itself fails (network): show a full-page error with a Retry button.

### Auto-refresh

- If `currentDate` equals today or tomorrow in the user's local timezone, set a `setInterval` to reload every 30 minutes.
- Clear the interval when the user navigates to a different date.

### WMO code → emoji (frontend)

```javascript
function weatherIcon(wmoCode) {
  if (wmoCode === 0) return '☀️';
  if (wmoCode <= 2) return '🌤';
  if (wmoCode === 3) return '☁️';
  if (wmoCode <= 48) return '🌫';
  if (wmoCode <= 67) return '🌧';
  if (wmoCode <= 77) return '❄️';
  if (wmoCode <= 82) return '🌦';
  if (wmoCode <= 86) return '🌨';
  return '⛈';
}
```

---

## Configuration

### `.env.example` (committed to repo)

```env
PORT=3000

# Wilma — parent account credentials for pirkkala.inschool.fi
WILMA_BASE_URL=https://pirkkala.inschool.fi
WILMA_USERNAME=
WILMA_PASSWORD=
# WILMA_MFA_SECRET=   # Only if your account uses TOTP 2FA

# Google Calendar — OAuth2 credentials
# GOOGLE_CALENDAR_ID defaults to "primary" if not set
GOOGLE_CALENDAR_ID=primary
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
```

### `.gitignore`

```
.env
node_modules/
dist/
```

---

## Error handling rules

- Use `Promise.allSettled` in the route — never `Promise.all` — so one source failure doesn't fail the whole response.
- Wrap each source call: `Promise.race([sourceFn(date), timeout(10_000)])`.
- `timeout(ms)` is a helper that returns a Promise rejecting after `ms` ms.
- Log errors server-side (Fastify's built-in logger). Do not expose stack traces to the client.
- If the date param is invalid, return HTTP 400 `{ error: "Invalid date format. Use YYYY-MM-DD" }`.

---

## Build Order

1. **Scaffold** — `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/index.ts` with Fastify + static serving, empty route and source stubs
2. **Types** — write all interfaces in `src/types.ts` up front
3. **Weather** — no auth needed; implement and test first to validate the pattern
4. **Wilma** — install and authenticate; fetch overview; filter to date; handle multi-student
5. **Google Calendar** — write the one-time token script; implement the fetcher
6. **Aggregator route** — wire all three sources with `Promise.allSettled` + timeout
7. **Frontend** — full HTML page with navigation, rendering, loading/error states
8. **PWA Support** — add `manifest.json` and `sw.js`
9. **Polish** — verify timezone edge cases (midnight, DST boundary); check mobile layout

---

## Key Constraints

- **Timezone**: All date math must use `Europe/Helsinki`. "Tomorrow" server-side must be computed in Helsinki time, not UTC.
- **No database**: No caching layer. Every request fetches live data. This is acceptable since the dashboard is loaded on demand, not polled continuously.
- **Wilma session**: Create the Wilma client once at startup. Do not re-authenticate per request.
- **Google token refresh**: The `googleapis` client handles token refresh automatically using the refresh token. No manual refresh needed.
- **Port binding**: Bind to `0.0.0.0` not `127.0.0.1` so it's accessible on the local network (useful for checking from phone).
