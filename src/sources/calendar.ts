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

    const d = new Date(`${date}T12:00:00Z`); // use noon UTC as a base to avoid edge cases
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Helsinki',
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(d);
    let offset = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+03:00';
    offset = offset.replace('GMT', '');
    if (offset === '') offset = '+00:00';
    
    const timeMin = `${date}T00:00:00${offset}`;
    const timeMax = `${date}T23:59:59${offset}`;

    const calendarIds = (process.env.GOOGLE_CALENDAR_ID || 'primary').split(',').map(id => id.trim());
    const allEvents: CalendarEvent[] = [];

    for (const calendarId of calendarIds) {
      try {
        const res = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
        });

        const items = res.data.items || [];

        for (const item of items) {
          if (item.start?.date) {
            // All day event
            allEvents.push({
              title: item.summary || 'Untitled Event',
              time: 'All day',
              durationMinutes: null,
            });
          } else if (item.start?.dateTime && item.end?.dateTime) {
            // Timed event
            const startDate = new Date(item.start.dateTime);
            const endDate = new Date(item.end.dateTime);
            
            const timeFormatter = new Intl.DateTimeFormat('sv-SE', {
              timeZone: 'Europe/Helsinki',
              hour: '2-digit',
              minute: '2-digit',
            });
            const timeStr = timeFormatter.format(startDate);
            
            const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
            
            allEvents.push({
              title: item.summary || 'Untitled Event',
              time: timeStr,
              durationMinutes,
            });
          }
        }
      } catch (e) {
        console.error(`Failed to fetch calendar ${calendarId}:`, e);
        // Continue to next calendar even if one fails
      }
    }

    // Sort combined events by time
    allEvents.sort((a, b) => {
      if (a.time === 'All day') return -1;
      if (b.time === 'All day') return 1;
      return a.time.localeCompare(b.time);
    });

    return allEvents;
  } catch (error: any) {
    return { error: true, message: error.message || 'Failed to fetch Calendar data' };
  }
}
