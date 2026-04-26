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
