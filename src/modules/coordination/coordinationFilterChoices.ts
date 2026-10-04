import type { School, SchoolClassRecord, SchoolSection, SchoolYear, Student } from "../../types";
import { getSchoolClassChoices, getSchoolSections } from "../../utils/schoolConfig";
import { getClassSection } from "../../utils/studentClasses";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../../utils/schoolOptions";
import { COORDINATION_ACTIVE_YEAR } from "../../services/coordinationStudentPagination";

export type CoordinationClassChoice = { value: string; label: string; schoolId: string; name: string };

function optionKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");
}

/** Class documents are year-scoped. School configuration is retained only for legacy years without class documents. */
export function coordinationFilterChoices(
  schools: readonly School[], years: readonly SchoolYear[], records: readonly SchoolClassRecord[],
  selectedSchoolId: string, selectedYearId: string, allowedSections: readonly SchoolSection[], selectedClassKey: string,
) {
  const visibleSchools = schools.filter((school) => school.status === "active" && (!selectedSchoolId || school.id === selectedSchoolId));
  const sources = years.filter((year) => visibleSchools.some((school) => school.id === year.schoolId
    && (selectedYearId === COORDINATION_ACTIVE_YEAR ? school.activeSchoolYearId === year.id : !selectedYearId || selectedYearId === year.id)));
  const names = new Map<string, CoordinationClassChoice>();
  for (const year of sources) {
    const school = visibleSchools.find((item) => item.id === year.schoolId)!;
    const scoped = records.filter((record) => record.schoolId === school.id && record.schoolYearId === year.id && record.active !== false);
    const baseClasses = scoped.filter((record) => !record.parentClassId && !record.option && !record.classOptionKey);
    const classNames = baseClasses.length ? baseClasses.map((record) => record.name) : getSchoolClassChoices(school);
    for (const name of classNames) {
      if (allowedSections.length && !allowedSections.includes(getClassSection(name as Student["className"]))) continue;
      const value = `${school.id}::${name}`;
      names.set(value, { value, name, schoolId: school.id, label: `${name}${selectedSchoolId ? "" : ` — ${school.name}`}` });
    }
  }
  const classes = [...names.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
  const selectedClass = classes.find((choice) => choice.value === selectedClassKey);
  const options = new Map<string, string>();
  if (!allowedSections.length || allowedSections.includes("Secondaire")) for (const year of sources) {
    const school = visibleSchools.find((item) => item.id === year.schoolId)!;
    if (!getSchoolSections(school).includes("Secondaire") || selectedClass && selectedClass.schoolId !== school.id) continue;
    if (selectedClass && getClassSection(selectedClass.name as Student["className"]) !== "Secondaire") continue;
    const scoped = records.filter((record) => record.schoolId === school.id && record.schoolYearId === year.id && record.active !== false);
    const parents = scoped.filter((record) => !record.parentClassId && !record.option && !record.classOptionKey);
    const selectedParents = selectedClass ? parents.filter((record) => record.name === selectedClass.name) : parents;
    const parentIds = new Set(selectedParents.map((record) => record.id));
    const configured = normalizeSchoolOptions(school.schoolOptions);
    const operational = scoped.filter((record) => (record.option || record.classOptionKey)
      && (!selectedClass || parentIds.has(record.parentClassId ?? record.id)));
    const available = operational.length ? operational.map((record) => record.option?.trim() || configured.find((name) => optionKey(name) === record.classOptionKey?.split("::").at(-1)) || "") : scoped.length === 0 ? configured : [];
    for (const raw of available) {
      const name = canonicalSchoolOption(raw);
      if (name) options.set(optionKey(name), name);
    }
  }
  return { classes, options: [...options.values()].sort((a, b) => a.localeCompare(b, "fr")) };
}
