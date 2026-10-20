import type { ConsolidatedClassReport } from "./consolidatedGrades";
import { editableGradingSlots, type EditableGradingSlot } from "./teacherGrading";

export type ConsolidatedTab = "grades" | "ranking";
export type ConsolidatedFilterMode = "period" | "course" | "student" | "place";
export type ConsolidatedFilter = { mode: ConsolidatedFilterMode; choice: string; placeSlot: EditableGradingSlot };
export const consolidatedPeriodLabels: Record<EditableGradingSlot, string> = {
  period_1: "1ère Période", period_2: "2ème Période", semester_1_exam: "Examen 1er Semestre",
  period_3: "3ème Période", period_4: "4ème Période", semester_2_exam: "Examen 2ème Semestre",
};

export function consolidatedSelection(report: ConsolidatedClassReport, tab: ConsolidatedTab, filter: ConsolidatedFilter) {
  const slots = filter.mode === "period" && editableGradingSlots.includes(filter.choice as EditableGradingSlot)
    ? [filter.choice as EditableGradingSlot]
    : filter.mode === "place" ? [filter.placeSlot] : [...editableGradingSlots];
  const courses = tab === "grades" && filter.mode === "course" && filter.choice
    ? report.courses.filter((course) => course.key === filter.choice) : report.courses;
  const students = filter.mode === "student"
    ? report.students.filter((row) => row.student.id === filter.choice)
    : filter.mode === "place"
      ? report.students.filter((row) => row.evaluations[filter.placeSlot].rank !== null
        && String(row.evaluations[filter.placeSlot].rank) === filter.choice)
      : report.students;
  return { slots, courses, students };
}

export function rankingPlaces(report: ConsolidatedClassReport, slot: EditableGradingSlot) {
  return [...new Set(report.students.map((row) => row.evaluations[slot].rank).filter((rank): rank is number => rank !== null))]
    .sort((a, b) => a - b);
}
