import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PublicHoliday } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', '..', 'holidays-cache.json');

let cache: PublicHoliday[] = [];

export async function loadHolidayCacheFromDisk(log: any): Promise<void> {
  try {
    const data = await readFile(CACHE_PATH, 'utf-8');
    cache = JSON.parse(data);
    log.info(`Holidays: loaded ${cache.length} holidays from disk cache`);
  } catch {
    log.info('Holidays: no disk cache, will fetch on startup');
  }
}

async function fetchYear(year: number): Promise<PublicHoliday[]> {
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/FI`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any[] = await res.json();
  return data.map(h => ({ date: h.date, name: h.name, localName: h.localName }));
}

export async function refreshHolidayCache(log: any): Promise<void> {
  const currentYear = new Date().getFullYear();

  if (cache.some(h => h.date.startsWith(`${currentYear}-`))) {
    log.info('Holidays: cache already covers current year, skipping fetch');
    return;
  }

  const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3];
  log.info(`Holidays: fetching for ${years.join(', ')}...`);

  const results = await Promise.allSettled(years.map(fetchYear));
  const all: PublicHoliday[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      all.push(...r.value);
      log.info(`Holidays: ${r.value.length} holidays for ${years[i]}`);
    } else {
      log.error(`Holidays: failed to fetch ${years[i]}: ${r.reason}`);
    }
  }

  if (all.length > 0) {
    cache = all;
    try {
      await writeFile(CACHE_PATH, JSON.stringify(all, null, 2), 'utf-8');
    } catch (err) {
      log.error(`Holidays: failed to write disk cache: ${err}`);
    }
  }
}

export function getHolidayForDate(date: string): PublicHoliday | null {
  return cache.find(h => h.date === date) ?? null;
}
