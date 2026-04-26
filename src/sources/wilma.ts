import { KidData, SourceError } from '../types.js';
import { WilmaClient, WilmaProfile, StudentInfo } from '@wilm-ai/wilma-client';

export interface WilmaConfig {
  profile: WilmaProfile;
  students: StudentInfo[];
}

function formatWilmaDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(d);
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' }).format(d).replace(/\//g, '.');
  return `${weekday} ${dayMonth}`;
}

export async function fetchWilma(config: WilmaConfig, date: string, studentFilter?: string[]): Promise<KidData[] | SourceError> {
  try {
    const kidsData: KidData[] = [];

    const { profile, students } = config;
    
    // Apply filter if provided
    const targetStudents = studentFilter && studentFilter.length > 0
      ? students.filter(s => studentFilter.includes(s.name))
      : students;

    if (students.length === 0) {
      // Fallback: direct account — login without student number
      const client = await WilmaClient.login(profile);
      const overview = await client.overview.get();

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

    for (const student of targetStudents) {
      const studentProfile = { ...profile, studentNumber: student.studentNumber };
      const client = await WilmaClient.login(studentProfile);
      const overview = await client.overview.get();

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
