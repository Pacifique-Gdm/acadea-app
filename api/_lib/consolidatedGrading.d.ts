import type { Student } from "../../src/types";
import type { PedagogicalAssignment, StudyClass, StudySubject } from "../../src/modules/studies/studyTypes";
import type { CourseGradingConfig, GradeEntry } from "../../src/modules/teacher/teacherGrading";
import type { ConsolidatedClassReport } from "../../src/modules/teacher/consolidatedGrades";

export const GRADE_SLOTS: readonly string[];
export function calculateConsolidatedReport(input: {
  classId: string;
  students: Student[];
  classes: StudyClass[];
  subjects: StudySubject[];
  assignments: PedagogicalAssignment[];
  configs: CourseGradingConfig[];
  entries: GradeEntry[];
}): ConsolidatedClassReport;
