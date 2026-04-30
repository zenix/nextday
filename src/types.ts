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

export interface AppConfig {
  port?: number;
  calendars: Array<{ name: string; url: string }>;
  widgetOrder: string[];
  accentColor: string;
  wilma?: {
    baseUrl?: string;
    username?: string;
    password?: string;
  };
}
