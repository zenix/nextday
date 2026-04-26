import { KidData, SourceError } from '../types.js';
import { WilmaClient, WilmaProfile, StudentInfo } from '@wilm-ai/wilma-client';

export interface WilmaConfig {
  profile: WilmaProfile;
  students: StudentInfo[];
}

export async function fetchWilma(config: WilmaConfig, date: string): Promise<KidData[] | SourceError> {
  try {
    const kidsData: KidData[] = [];

    const { profile, students } = config;

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
          dueDate: hw.date,
        }));
      const exams = overview.upcomingExams
        .filter(exam => exam.date >= date)
        .map(exam => ({
          subject: exam.subject,
          date: exam.date,
        }));
      kidsData.push({ name: 'My Schedule', schedule, homework, exams });
      return kidsData;
    }

    for (const student of students) {
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
          dueDate: hw.date,
        }));
      const exams = overview.upcomingExams
        .filter(exam => exam.date >= date)
        .map(exam => ({
          subject: exam.subject,
          date: exam.date,
        }));

      kidsData.push({ name: student.name, schedule, homework, exams });
    }

    return kidsData;
  } catch (error: any) {
    return { error: true, message: error.message || 'Failed to fetch Wilma data' };
  }
}
