import type { AppUser, SchoolSection } from "../../types";
import { isSectionAllowed, userSectionIds } from "../../utils/userSections";

// Lot R2 (Réglages par section) : même règle que le serveur (api/_lib/studySectionScope.js).
// Un compte AVEC sections ne voit que les demandes des enseignants de ses sections :
// enseignant sans section, enseignant d'une de ses sections, ou affecté à une classe de ses sections.
// Un compte SANS section voit toutes les demandes, exactement comme avant.
type ScopeTeacher = { id: string; section?: SchoolSection; sectionIds?: SchoolSection[] };
type ScopeAssignment = { teacherId: string; classId: string; active?: boolean };

export function scopeAvailabilityRequests<T extends { teacherId: string }>(input: {
  user: Pick<AppUser, "section" | "sectionIds">;
  items: readonly T[];
  teachers: readonly ScopeTeacher[];
  assignments?: readonly ScopeAssignment[];
  /** Classes déjà limitées aux sections du compte. */
  classes?: readonly { id: string }[];
}): T[] {
  if (!userSectionIds(input.user).length) return [...input.items];
  const allowed = new Set(input.teachers.filter((teacher) => {
    const own = teacher.sectionIds?.length ? teacher.sectionIds : teacher.section ? [teacher.section] : [];
    return !own.length || own.some((section) => isSectionAllowed(input.user, section));
  }).map((teacher) => teacher.id));
  const classIds = new Set((input.classes ?? []).map((item) => item.id));
  for (const assignment of input.assignments ?? []) {
    if (assignment.active !== false && classIds.has(assignment.classId)) allowed.add(assignment.teacherId);
  }
  return input.items.filter((item) => allowed.has(item.teacherId));
}
