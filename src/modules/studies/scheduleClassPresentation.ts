import type { PedagogicalAssignment, StudyClass, TimetableEntry } from "./studyTypes";
import { assignmentScopeLabel } from "./studyCourseScope";

const comparable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");

export function scheduleClassPresentation(entry: TimetableEntry, assignment: PedagogicalAssignment | undefined, classes: readonly StudyClass[]) {
  const name = classes.find((schoolClass) => schoolClass.id === entry.classId)?.name ?? "—";
  // The saved timetable scope is authoritative; historical entries may only have the assignment scope.
  const source = entry.courseScope ? entry : assignment;
  const scope = source ? assignmentScopeLabel(source, classes) : "";
  const missingOptions = scope.split(" + ").filter((option) => option && !comparable(name).includes(comparable(option)));
  return { name, scope: missingOptions.join(" + ") };
}
