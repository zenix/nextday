import ical from 'node-ical';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CalendarEvent, SourceError } from '../types.js';
import { getConfig } from '../routes/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', '..', 'calendar-cache.json');

// Rolling window: 30 days back, 365 days forward from now
const WINDOW_BACK_MS  = 30  * 24 * 60 * 60 * 1000;
const WINDOW_FWD_MS   = 365 * 24 * 60 * 60 * 1000;

interface NormalizedEvent {
  title: string;
  start: string;   // ISO datetime (UTC) for timed; "YYYY-MM-DD" for all-day
  end: string;     // same
  allDay: boolean;
}

interface CachedFeed {
  name: string;
  url: string;
  fetchedAt: string;
  events: NormalizedEvent[];
}

// In-memory store: url → NormalizedEvent[]
const cache = new Map<string, NormalizedEvent[]>();

function isAllDayEvent(ev: any): boolean {
  return ev.datetype === 'date' || (ev.start && (ev.start as any).dateOnly === true);
}

// rrule's internal dateInTimeZone() computes offset = tzTarget - tzServer.
// When the server's local timezone equals the event's TZID (e.g. both are
// Europe/Helsinki), the offset is zero and no conversion is applied —
// occurrence dates come back with the local event time packed into the UTC
// fields instead of real UTC. Detect this and convert properly.
function correctRruleOccurrence(occ: Date, tzid: string): Date {
  // Extract the local time that rrule stored in the UTC fields.
  const y  = occ.getUTCFullYear();
  const mo = String(occ.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(occ.getUTCDate()).padStart(2, '0');
  const h  = String(occ.getUTCHours()).padStart(2, '0');
  const mi = String(occ.getUTCMinutes()).padStart(2, '0');
  const s  = String(occ.getUTCSeconds()).padStart(2, '0');
  const localStr = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  // naive treats the local-time string as UTC so we can do arithmetic on it.
  const naive = new Date(localStr + 'Z');
  // What does tzid display for this naive instant?
  const inTZ = new Date(
    naive.toLocaleString('sv-SE', { timeZone: tzid }).replace(' ', 'T') + 'Z'
  );
  // Shift naive back by the difference: result = local_time - tz_offset = proper UTC.
  return new Date(naive.getTime() + (naive.getTime() - inTZ.getTime()));
}

function toISO(d: Date, allDay: boolean): string {
  if (allDay) {
    // Format as YYYY-MM-DD using UTC parts to avoid timezone shift
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return d.toISOString();
}

async function fetchAndParseFeed(name: string, url: string): Promise<NormalizedEvent[]> {
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_BACK_MS);
  const windowEnd   = new Date(now + WINDOW_FWD_MS);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching calendar "${name}"`);
  const text = await res.text();

  const parsed = await ical.async.parseICS(text);
  const events: NormalizedEvent[] = [];

  for (const key of Object.keys(parsed)) {
    const ev: any = (parsed as any)[key];
    if (!ev || ev.type !== 'VEVENT') continue;

    const allDay = isAllDayEvent(ev);
    const durationMs = ev.end && ev.start
      ? new Date(ev.end).getTime() - new Date(ev.start).getTime()
      : 0;

    if (ev.rrule) {
      // Expand recurrence into the rolling window
      const occurrences: Date[] = ev.rrule.between(windowStart, windowEnd, true);
      const exdates: Set<number> = new Set(
        ev.exdate ? Object.values(ev.exdate).map((d: any) => new Date(d).getTime()) : []
      );

      // rrule only corrects occurrence times when server TZ != event TZID.
      // When they match, apply the correction ourselves.
      const rruleTzid: string | undefined = (ev.rrule.options as any)?.tzid ?? undefined;
      const serverTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const mustCorrect = !!(rruleTzid && rruleTzid === serverTZ);

      for (const occ of occurrences) {
        const occUTC = mustCorrect ? correctRruleOccurrence(occ, rruleTzid!) : occ;

        if (exdates.has(occUTC.getTime())) continue;

        const overrideKey = occUTC.toISOString().slice(0, 10);
        const override = ev.recurrences?.[overrideKey];
        const start = override ? new Date(override.start) : occUTC;
        const end   = override ? new Date(override.end)   : new Date(occUTC.getTime() + durationMs);
        const title = (override?.summary || ev.summary || 'Untitled Event') as string;

        events.push({ title, start: toISO(start, allDay), end: toISO(end, allDay), allDay });
      }
    } else {
      // Non-recurring: include only if it overlaps the window
      const start = new Date(ev.start);
      const end   = ev.end ? new Date(ev.end) : start;
      if (end < windowStart || start > windowEnd) continue;

      events.push({
        title: (ev.summary || 'Untitled Event') as string,
        start: toISO(start, allDay),
        end:   toISO(end,   allDay),
        allDay,
      });
    }
  }

  return events;
}

export async function loadCacheFromDisk(log: any): Promise<void> {
  try {
    const data = await readFile(CACHE_PATH, 'utf-8');
    const feeds: CachedFeed[] = JSON.parse(data);
    for (const feed of feeds) {
      cache.set(feed.url, feed.events);
    }
    log.info(`Calendar: loaded ${feeds.length} feed(s) from disk cache`);
  } catch {
    log.info('Calendar: no disk cache found, will populate on first refresh');
  }
}

async function writeCacheToDisk(feeds: CachedFeed[]): Promise<void> {
  await writeFile(CACHE_PATH, JSON.stringify(feeds, null, 2), 'utf-8');
}

export async function refreshCalendarCache(log: any): Promise<void> {
  const config = await getConfig();
  const calendars = config.calendars || [];
  if (calendars.length === 0) {
    log.info('Calendar: no calendars configured, skipping refresh');
    return;
  }

  log.info(`Calendar: refreshing ${calendars.length} feed(s)...`);
  const updatedFeeds: CachedFeed[] = [];

  await Promise.allSettled(
    calendars.map(async (cal) => {
      try {
        const events = await fetchAndParseFeed(cal.name, cal.url);
        cache.set(cal.url, events);
        updatedFeeds.push({ name: cal.name, url: cal.url, fetchedAt: new Date().toISOString(), events });
        log.info(`Calendar: "${cal.name}" — ${events.length} events cached`);
      } catch (err) {
        log.error(`Calendar: failed to refresh "${cal.name}": ${err}`);
        // Keep stale data in cache; don't add to updatedFeeds so we don't overwrite disk
      }
    })
  );

  if (updatedFeeds.length > 0) {
    try {
      await writeCacheToDisk(updatedFeeds);
    } catch (err) {
      log.error(`Calendar: failed to write disk cache: ${err}`);
    }
  }
}

function helsinkiOffset(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Helsinki',
    timeZoneName: 'longOffset',
  }).formatToParts(d);
  let offset = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+03:00';
  offset = offset.replace('GMT', '');
  return offset === '' ? '+00:00' : offset;
}

function formatHelsinkiTime(isoStr: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Helsinki',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoStr));
}

export async function fetchCalendar(date: string): Promise<CalendarEvent[] | SourceError> {
  try {
    const config = await getConfig();
    const calendars = config.calendars || [];
    if (calendars.length === 0) return [];

    const offset = helsinkiOffset(date);
    const dayStart = new Date(`${date}T00:00:00${offset}`);
    const dayEnd   = new Date(`${date}T23:59:59${offset}`);

    const allEvents: CalendarEvent[] = [];

    for (const cal of calendars) {
      const events = cache.get(cal.url) || [];
      for (const ev of events) {
        if (ev.allDay) {
          // All-day: compare YYYY-MM-DD strings directly
          if (ev.start === date) {
            allEvents.push({ title: ev.title, time: 'All day', durationMinutes: null });
          }
        } else {
          const start = new Date(ev.start);
          const end   = new Date(ev.end);
          // Include if event overlaps the day
          if (start < dayEnd && end > dayStart) {
            const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
            allEvents.push({ title: ev.title, time: formatHelsinkiTime(ev.start), durationMinutes });
          }
        }
      }
    }

    allEvents.sort((a, b) => {
      if (a.time === 'All day') return -1;
      if (b.time === 'All day') return 1;
      return a.time.localeCompare(b.time);
    });

    return allEvents;
  } catch (error: any) {
    return { error: true, message: error.message || 'Failed to read calendar cache' };
  }
}
