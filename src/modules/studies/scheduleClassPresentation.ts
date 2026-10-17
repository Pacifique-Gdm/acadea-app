import type { PedagogicalAssignment, StudyClass, TimetableEntry } from "./studyTypes";
import { schoolClassOptionKey } from "../../services/schoolSubclasses";
import { baseStudyClassId, classOptionId, normalizedAssignmentScope } from "./studyCourseScope";

const comparable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");

export function scheduleClassPresentation(entry: TimetableEntry, assignment: PedagogicalAssignment | undefined, classes: readonly StudyClass[], schoolOptions: readonly string[] = []) {
  const referenced = classes.find((item) => item.id === entry.classId);
  const name = referenced?.name ?? "—";
  // The saved timetable scope is authoritative; historical entries may only have the assignment scope.
  const source = entry.courseScope ? entry : assignment;
  if (!source) return { name, scope: "" };
  const { baseClassId, optionIds } = normalizedAssignmentScope(source, classes);
  if (!optionIds?.length) return { name, scope: "" };

  const scopedClasses = classes.filter((item) => item.schoolId === referenced?.schoolId
    && item.schoolYearId === referenced?.schoolYearId && baseStudyClassId(item) === baseClassId);
  const optionClass = (id: string) => scopedClasses.find((item) => item.id === id && !item.subClassLabel && classOptionId(item) === id)
    ?? scopedClasses.find((item) => !item.subClassLabel && classOptionId(item) === id);
  const optionLabel = (id: string) => schoolOptions.find((option) => schoolClassOptionKey(baseClassId, option) === id)
    ?? optionClass(id)?.option?.trim()
    ?? id.split("::").at(-1)
    ?? id;

  // A verified operational class supplies the full label for a single-option course.
  // Never replace a different referenced option or a distinct subclass.
  if (optionIds.length === 1 && referenced && (!classOptionId(referenced) || classOptionId(referenced) === optionIds[0])
    && !referenced.subClassLabel) {
    const target = optionClass(optionIds[0]);
    if (target) return { name: target.name, scope: "" };
  }

  // A multi-option course retains its distinct scope. Canonical ids take priority
  // over text matching when avoiding repetition on a single-option course.
  const labels = optionIds.filter((id) => optionIds.length > 1 || !referenced || classOptionId(referenced) !== id).map(optionLabel);
  return { name, scope: optionIds.length > 1 ? labels.join(" + ") : labels.filter((label) => !comparable(name).includes(comparable(label))).join(" + ") };
}
