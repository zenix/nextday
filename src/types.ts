export interface WeatherData {
  summary: string;
  tempMax: number;
  tempMin: number;
  precipitationMm: number;
  windKph: number;
  wmoCode: number;
  hourly: {
    time: string; // "Morning", "Midday", "Evening"
    temp: number;
    wmoCode: number;
  }[];
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

export interface PublicHoliday {
  date: string;      // YYYY-MM-DD
  name: string;      // English name
  localName: string; // Finnish name
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
  holiday: PublicHoliday | null;
}

// --- Public config: safe to serialize to any authenticated client ---
// Never contains a credential or a secret calendar URL.
export interface PublicCalendarConfig {
  id: string;
  name: string;
}

export interface PublicConfig {
  calendars: PublicCalendarConfig[];
  widgetOrder: string[];
  accentColor: string;
  // Additional hostnames (beyond localhost/the LAN address) allowed in the
  // Host header. See src/security/hostCheck.ts.
  allowedHosts: string[];
}

// What GET /api/config actually returns: PublicConfig plus booleans that
// tell the UI whether a secret is configured, never the secret itself.
export interface ConfigResponse extends PublicConfig {
  wilma: {
    baseUrl: string;
    username: string;
    passwordSet: boolean;
  };
  calendars: Array<PublicCalendarConfig & { urlSet: boolean }>;
}

// --- Secrets: server-only, lives in secrets.json (mode 0600), never
// serialized in an API response body. ---
export interface SecretsConfig {
  wilma: {
    baseUrl?: string;
    username?: string;
    password?: string;
  };
  // calendar id -> secret iCal URL
  calendarUrls: Record<string, string>;
  auth?: {
    salt: string;
    hash: string;
  };
}

// Legacy on-disk shape (pre-hardening): everything lived in one
// config.json. Only used by the one-shot migration in src/config/store.ts.
export interface LegacyAppConfig {
  port?: number;
  calendars?: Array<{ id?: string; name?: string; url?: string }>;
  widgetOrder?: string[];
  accentColor?: string;
  wilma?: {
    baseUrl?: string;
    username?: string;
    password?: string;
  };
  google?: unknown;
  [key: string]: unknown;
}
