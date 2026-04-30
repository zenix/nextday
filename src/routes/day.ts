import { FastifyInstance } from 'fastify';
import { fetchWeather } from '../sources/weather.js';
import { fetchWilma, WilmaConfig } from '../sources/wilma.js';
import { fetchCalendar } from '../sources/calendar.js';
import { getHolidayForDate } from '../sources/holidays.js';

function timeout(ms: number) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Source timeout')), ms);
  });
}

function getTomorrowHelsinki(): string {
  const now = new Date();
  const helsinkiDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const [y, m, d] = helsinkiDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export async function dayRoute(app: FastifyInstance, getWilmaConfig: () => WilmaConfig | null) {
  app.get('/api/day', async (request, reply) => {
    const wilmaConfig = getWilmaConfig();
    const query = request.query as any;
    let date = query.date;

    if (!date) {
      date = getTomorrowHelsinki();
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const weatherPromise = Promise.race([fetchWeather(date), timeout(10_000)]);
    const wilmaPromise = wilmaConfig
      ? Promise.race([fetchWilma(wilmaConfig, date), timeout(30_000)])
      : Promise.resolve({ error: true as const, message: 'Wilma not configured' });
    const calendarPromise = Promise.race([fetchCalendar(date), timeout(10_000)]);

    const [weatherResult, wilmaResult, calendarResult] = await Promise.allSettled([
      weatherPromise,
      wilmaPromise,
      calendarPromise
    ]);

    return {
      date,
      holiday: getHolidayForDate(date),
      weather: weatherResult.status === 'fulfilled' ? weatherResult.value : { error: true, message: String(weatherResult.reason) },
      kids: wilmaResult.status === 'fulfilled' ? wilmaResult.value : { error: true, message: String(wilmaResult.reason) },
      calendar: calendarResult.status === 'fulfilled' ? calendarResult.value : { error: true, message: String(calendarResult.reason) },
    };
  });
}
