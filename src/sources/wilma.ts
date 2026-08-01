import { KidData, SourceError } from '../types.js';
import { WilmaClient, WilmaProfile, StudentInfo } from '@wilm-ai/wilma-client';

export interface WilmaConfig {
  profile: WilmaProfile;
  students: StudentInfo[];
}

// Logging into Wilma on every /api/day request re-transmits the password
// on every dashboard poll and risks account lockout under repeated auth.
// Cache the logged-in client per student for a while instead; a stale
// session just fails once and gets replaced (see withClient below).
const SESSION_TTL_MS = 20 * 60 * 1000;

interface CachedClient {
  client: WilmaClient;
  expiresAt: number;
}

const clientCache = new Map<string, CachedClient>(); // key: studentNumber, or 'default' for a direct account

async function getClient(key: string, profile: WilmaProfile): Promise<WilmaClient> {
  const cached = clientCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.client;
  const client = await WilmaClient.login(profile);
  clientCache.set(key, { client, expiresAt: Date.now() + SESSION_TTL_MS });
  return client;
}

// Runs fn against a cached, logged-in client. If the cached session turns
// out to be dead (e.g. expired server-side, or the process just started
// and it's not in cache yet), evicts it and retries once with a fresh
// login rather than surfacing the transient failure.
async function withClient<T>(key: string, profile: WilmaProfile, fn: (client: WilmaClient) => Promise<T>): Promise<T> {
  const client = await getClient(key, profile);
  try {
    return await fn(client);
  } catch (err) {
    clientCache.delete(key);
    const fresh = await getClient(key, profile);
    return await fn(fresh);
  }
}

function formatWilmaDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(d);
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' }).format(d).replace(/\//g, '.');
  return `${weekday} ${dayMonth}`;
}

export async function fetchWilma(config: WilmaConfig, date: string): Promise<KidData[] | SourceError> {
  try {
    const kidsData: KidData[] = [];

    const { profile, students } = config;

    if (students.length === 0) {
      // Fallback: direct account — login without student number
      const overview = await withClient('default', profile, c => c.overview.get());

      const schedule = overview.schedule
        .filter(lesson => lesson.date === date)
        .map(lesson => ({
          time: lesson.start,
          subject: lesson.subject,
          teacher: lesson.teacher,
        }));
      const homework = overview.homework
        .filter(hw => hw.date >= date)
        .map(hw => ({
          subject: hw.subject,
          description: hw.homework,
          dueDate: formatWilmaDate(hw.date),
        }));
      const exams = overview.upcomingExams
        .filter(exam => exam.date >= date)
        .map(exam => ({
          subject: exam.subject,
          date: formatWilmaDate(exam.date),
        }));
      kidsData.push({ name: 'My Schedule', schedule, homework, exams });
      return kidsData;
    }

    for (const student of students) {
      const studentProfile = { ...profile, studentNumber: student.studentNumber };
      const overview = await withClient(student.studentNumber, studentProfile, c => c.overview.get());

      const schedule = overview.schedule
        .filter(lesson => lesson.date === date)
        .map(lesson => ({
          time: lesson.start,
          subject: lesson.subject,
          teacher: lesson.teacher,
        }));
      const homework = overview.homework
        .filter(hw => hw.date >= date)
        .map(hw => ({
          subject: hw.subject,
          description: hw.homework,
          dueDate: formatWilmaDate(hw.date),
        }));
      const exams = overview.upcomingExams
        .filter(exam => exam.date >= date)
        .map(exam => ({
          subject: exam.subject,
          date: formatWilmaDate(exam.date),
        }));

      kidsData.push({ name: student.name, schedule, homework, exams });
    }

    return kidsData;
  } catch (error: any) {
    return { error: true, message: error.message || 'Failed to fetch Wilma data' };
  }
}
