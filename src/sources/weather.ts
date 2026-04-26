import { WeatherData, SourceError } from '../types.js';

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

// Compute "today" in Helsinki time to compare with requested date
function getTodayHelsinki(): string {
  const now = new Date();
  const helsinkiDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  return helsinkiDate;
}

export async function fetchWeather(date: string): Promise<WeatherData | SourceError> {
  const today = getTodayHelsinki();
  const isPast = date < today;

  // Coordinates for Pirkkala, Finland
  const lat = 61.467;
  const lon = 23.650;
  const dailyParams = 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode';
  const hourlyParams = 'temperature_2m,weathercode';
  const tz = 'Europe%2FHelsinki';

  let url = '';
  if (isPast) {
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=${dailyParams}&hourly=${hourlyParams}&timezone=${tz}&start_date=${date}&end_date=${date}`;
  } else {
    url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${dailyParams}&hourly=${hourlyParams}&timezone=${tz}&forecast_days=16`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { error: true, message: `Open-Meteo HTTP error: ${res.status}` };
    }
    const data = await res.json();
    
    const daily = data.daily;
    const hourly = data.hourly;
    if (!daily || !daily.time || !hourly) {
       return { error: true, message: 'Invalid response from Open-Meteo' };
    }

    const dailyIdx = daily.time.indexOf(date);
    if (dailyIdx === -1) {
      return { error: true, message: `Weather data not available for date ${date}` };
    }

    // Extract hourly points
    const morningTime = `${date}T08:00`;
    const middayTime = `${date}T13:00`;
    const eveningTime = `${date}T17:00`;

    const getHourlyVal = (targetTime: string) => {
      const idx = hourly.time.indexOf(targetTime);
      if (idx === -1) return null;
      return {
        temp: hourly.temperature_2m[idx],
        wmoCode: hourly.weathercode[idx]
      };
    };

    const morning = getHourlyVal(morningTime);
    const midday = getHourlyVal(middayTime);
    const evening = getHourlyVal(eveningTime);

    const hourlySnapshots = [];
    if (morning) hourlySnapshots.push({ time: 'Morning', ...morning });
    if (midday) hourlySnapshots.push({ time: 'Midday', ...midday });
    if (evening) hourlySnapshots.push({ time: 'Evening', ...evening });

    const wmoCode = daily.weathercode[dailyIdx];
    return {
      summary: WMO_CODES[wmoCode] || 'Unknown',
      tempMax: daily.temperature_2m_max[dailyIdx],
      tempMin: daily.temperature_2m_min[dailyIdx],
      precipitationMm: daily.precipitation_sum[dailyIdx],
      windKph: daily.wind_speed_10m_max[dailyIdx],
      wmoCode,
      hourly: hourlySnapshots
    };
  } catch (error: any) {
    return { error: true, message: error.message || 'Weather fetch failed' };
  }
}
