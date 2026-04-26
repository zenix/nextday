import { google } from 'googleapis';
import { CalendarEvent, SourceError } from '../types.js';

let oauth2Client: any = null;
let calendarAPI: any = null;

function getCalendarAPI() {
  if (calendarAPI) return calendarAPI;

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Calendar credentials missing from .env');
  }

  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  calendarAPI = google.calendar({ version: 'v3', auth: oauth2Client });
  return calendarAPI;
}

export async function fetchCalendar(date: string): Promise<CalendarEvent[] | SourceError> {
  try {
    const calendar = getCalendarAPI();

    // The provided date is in Europe/Helsinki. We need to construct the ISO string with correct timezone offset.
    // Helsinki is +02:00 in winter, +03:00 in summer.
    // The easiest way is to let Date parse it as Helsinki time by formatting it locally, 
    // or manually query the offset. Node 22 has great Intl support.
    
    // A robust way to construct the timeMin/timeMax for a specific timezone is to format parts and construct a local date,
    // but the Google Calendar API accepts RFC3339 timestamps. If we specify a time zone suffix, it will parse it correctly.
    // Let's determine the offset for the given date in Helsinki.
    
    const d = new Date(`${date}T12:00:00Z`); // use noon UTC as a base to avoid edge cases
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Helsinki',
      timeZoneName: 'longOffset',
    });
    // Formats like "4/27/2026, GMT+3"
    const parts = formatter.formatToParts(d);
    let offset = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+03:00';
    offset = offset.replace('GMT', '');
    if (offset === '') offset = '+00:00';
    
    // Now we have something like +03:00 or +02:00
    const timeMin = `${date}T00:00:00${offset}`;
    const timeMax = `${date}T23:59:59${offset}`;

    const res = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events: CalendarEvent[] = [];
    const items = res.data.items || [];

    for (const item of items) {
      if (item.start?.date) {
        // All day event
        events.push({
          title: item.summary || 'Untitled Event',
          time: 'All day',
          durationMinutes: null,
        });
      } else if (item.start?.dateTime && item.end?.dateTime) {
        // Timed event
        const startDate = new Date(item.start.dateTime);
        const endDate = new Date(item.end.dateTime);
        
        // Format start time in Helsinki
        const timeFormatter = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Europe/Helsinki',
          hour: '2-digit',
          minute: '2-digit',
        });
        const timeStr = timeFormatter.format(startDate);
        
        const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
        
        events.push({
          title: item.summary || 'Untitled Event',
          time: timeStr,
          durationMinutes,
        });
      }
    }

    return events;
  } catch (error: any) {
    return { error: true, message: error.message || 'Failed to fetch Calendar data' };
  }
}
