import type { SchoolSection } from "../../types";

export interface StudyTeacher {
  id: string;
  userId?: string;
  schoolId: string;
  schoolYearId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  email?: string;
  phone?: string;
  section?: SchoolSection;
  sectionIds?: SchoolSection[];
}

export interface StudySubject {
  id: string;
  schoolId: string;
  schoolYearId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  section?: SchoolSection;
  classIds?: string[];
}

export type StudyVacation = "morning" | "afternoon";

export interface StudyClass {
  id: string;
  schoolId: string;
  schoolYearId: string;
  name: string;
  active?: boolean;
  parentClassId?: string;
  classOptionKey?: string;
  subClassLabel?: string;
  section?: SchoolSection;
  option?: string;
  vacation?: StudyVacation;
  saturdayVacation?: StudyVacation | null;
  saturdayEnabled?: boolean;
}

export interface PedagogicalAssignment {
  id: string;
  schoolId: string;
  schoolYearId: string;
  teacherId: string;
  subjectId: string;
  classId: string;
  weeklyPeriods: number;
  blockSize?: 1 | 2;
  preferredRoomId?: string | null;
  titularClassId?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export type StudyDay = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
export type AvailabilityStatus = "available" | "unavailable" | "rest";
export interface TeacherAvailability { id:string; schoolId:string; schoolYearId:string; teacherId:string; dayOfWeek:StudyDay; status:AvailabilityStatus; startTime?:string; endTime?:string; active:boolean; createdBy:string; createdAt:string; updatedAt:string; }
export type SchedulePeriodType = "course" | "break" | "recess";
export interface SchedulePeriod { id:string; schoolId:string; schoolYearId:string; label:string; startTime:string; endTime:string; order:number; type:SchedulePeriodType; active:boolean; createdBy:string; createdAt:string; updatedAt:string; vacation?:StudyVacation; dayScope?:"weekdays"|"saturday"; }

export type TimetableStatus = "DRAFT" | "VALID" | "PUBLISHED";

export interface Timetable {
  id: string;
  schoolId: string;
  schoolYearId: string;
  version: number;
  status: TimetableStatus;
  activeDraft: boolean;
  activePublished?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  validatedAt?: string;
  validatedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
  generationMetadata: {
    algorithm: "deterministic-backtracking";
    exploredBranches: number;
    durationMs: number;
    maxSameAssignmentPeriodsPerDay: number;
  };
}

export interface TimetableEntry {
  id: string;
  scheduleId: string;
  schoolId: string;
  schoolYearId: string;
  classId: string;
  teacherId: string;
  subjectId: string;
  assignmentId: string;
  dayOfWeek: StudyDay;
  periodId: string;
  roomId: string | null;
  blockId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudyRoom { id:string; schoolId:string; schoolYearId:string; name:string; active:boolean; createdBy:string; createdAt:string; updatedAt:string; }

export type ScheduleValidationCode = "TEACHER_OVERLAP" | "CLASS_OVERLAP" | "ROOM_OVERLAP" | "TEACHER_UNAVAILABLE" | "REST_DAY" | "NON_TEACHING_PERIOD" | "WEEKLY_VOLUME_MISMATCH" | "DAILY_ASSIGNMENT_LIMIT" | "DOUBLE_PERIOD_BROKEN" | "INVALID_ASSIGNMENT" | "INVALID_SCOPE";
export interface ScheduleValidationIssue { code: ScheduleValidationCode; message: string; entityId?: string; day?: StudyDay; periodId?: string; metadata?: Record<string, unknown>; }
export interface ScheduleValidationReport { valid: boolean; errors: ScheduleValidationIssue[]; warnings: ScheduleValidationIssue[]; metrics: { entries: number; assignments: number; teachers: number; classes: number; rooms: number; }; }
