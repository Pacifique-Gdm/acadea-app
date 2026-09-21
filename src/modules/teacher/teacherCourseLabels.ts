import type { PedagogicalAssignment, StudyClass } from "../studies/studyTypes";
import { assignmentScopeLabel } from "../studies/studyCourseScope";

function normalizedWords(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").match(/[a-z0-9]+/g) ?? [];
}

export function teacherClassScopeLabel(
  className: string,
  assignment: Pick<PedagogicalAssignment, "classId" | "courseScope" | "targetOptionIds">,
  classes: readonly StudyClass[],
) {
  const scope = assignmentScopeLabel(assignment, classes);
  if (!scope) return className;
  const classWords = normalizedWords(className);
  const scopeWords = normalizedWords(scope);
  const alreadyNamed = scopeWords.length > 0 && classWords.some((_, start) =>
    scopeWords.every((word, offset) => classWords[start + offset] === word));
  return alreadyNamed ? className : `${className} · ${scope}`;
}
