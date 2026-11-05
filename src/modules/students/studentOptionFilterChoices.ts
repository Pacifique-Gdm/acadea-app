import type { School, SchoolClassRecord, SchoolSection, Student } from "../../types";
import { getSchoolClassChoices } from "../../utils/schoolConfig";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../../utils/schoolOptions";
import { getClassSection } from "../../utils/studentClasses";
import { canonicalClassNameFromRecordId, operationalBaseClassId, operationalClassOptionKey } from "../../utils/studentYearTransition.js";

const key = (value: string) => canonicalSchoolOption(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");

/** Offers only configured options actually linked to an accessible class in this school year. */
export function studentOptionFilterChoices({ school, schoolYearId, records, students, section, className }: {
  school: School;
  schoolYearId: string;
  records: readonly SchoolClassRecord[];
  students: readonly Student[];
  section: "all" | SchoolSection;
  className: string;
}) {
  if (section !== "all" && section !== "Secondaire") return [];
  const allowedClasses = new Set<string>(getSchoolClassChoices(school).filter((name) => getClassSection(name) === "Secondaire"));
  if (className && !allowedClasses.has(className)) return [];
  const annual = records.filter((record) => record.schoolId === school.id && record.schoolYearId === schoolYearId);
  const scoped = annual.filter((record) => record.active !== false);
  const allById = new Map(annual.map((record) => [record.id, record]));
  const byId = new Map(scoped.map((record) => [record.id, record]));
  const linked = new Set<string>();
  for (const record of scoped) {
    const option = record.option?.trim() || operationalClassOptionKey(record)?.split("::").at(-1)?.trim();
    if (!option) continue;
    const baseId = operationalBaseClassId(record);
    if (allById.get(baseId)?.active === false) continue;
    const baseName = byId.get(baseId)?.name ?? canonicalClassNameFromRecordId(baseId);
    if (!baseName || !allowedClasses.has(baseName) || (className && baseName !== className)) continue;
    linked.add(key(option));
  }
  for (const student of students) {
    if (student.schoolId !== school.id || student.schoolYearId !== schoolYearId || !student.option) continue;
    if (!allowedClasses.has(student.className) || (className && student.className !== className)) continue;
    linked.add(key(student.option));
  }
  return normalizeSchoolOptions(school.schoolOptions).filter((option) => linked.has(key(option)));
}
