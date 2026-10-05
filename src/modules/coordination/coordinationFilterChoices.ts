import type { School, SchoolClassRecord, SchoolSection, SchoolYear, Student } from "../../types";
import { getSchoolClassChoices, getSchoolSections } from "../../utils/schoolConfig";
import { getClassSection } from "../../utils/studentClasses";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../../utils/schoolOptions";
import { canonicalAnnualClassName, canonicalClassNameFromRecordId, operationalBaseClassId, operationalClassOptionKey } from "../../utils/studentYearTransition.js";
import { COORDINATION_ACTIVE_YEAR } from "../../services/coordinationStudentPagination";

export type CoordinationClassChoice = { value: string; label: string; schoolId: string; name: string; branchesBySource: Record<string, Array<{ name: string; option?: string; operational: boolean }>> };

function optionKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");
}

function parentIdsForName(records: readonly SchoolClassRecord[], name: string) {
  const ids = new Set<string>();
  for (const record of records) {
    const baseId = operationalBaseClassId(record);
    if (baseId === record.id && !record.option && !record.classOptionKey) {
      if ((canonicalAnnualClassName(record.name) ?? canonicalClassNameFromRecordId(record.id)) === name) ids.add(record.id);
    } else if (canonicalClassNameFromRecordId(baseId) === name) ids.add(baseId);
  }
  return ids;
}

/** School sections define parents; year-scoped records only identify operational branches. */
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
    for (const name of getSchoolClassChoices(school)) {
      if (allowedSections.length && !allowedSections.includes(getClassSection(name as Student["className"]))) continue;
      const value = `${school.id}::${name}`;
      const parentIds = parentIdsForName(scoped, name);
      const branches = [{ name, operational: false }, ...scoped.filter((record) => record.id !== operationalBaseClassId(record) && parentIds.has(operationalBaseClassId(record)))
        .map((record) => ({ name: record.name, option: canonicalSchoolOption(record.option?.trim() || operationalClassOptionKey(record)?.split("::").at(-1) || ""), operational: true }))];
      const previous = names.get(value);
      names.set(value, { value, name, schoolId: school.id, label: `${name}${selectedSchoolId ? "" : ` — ${school.name}`}`,
        branchesBySource: { ...previous?.branchesBySource, [`${school.id}::${year.id}`]: branches } });
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
    const parentIds = selectedClass ? parentIdsForName(scoped, selectedClass.name) : undefined;
    const configured = normalizeSchoolOptions(school.schoolOptions);
    const operational = scoped.filter((record) => operationalBaseClassId(record) !== record.id && (record.option || operationalClassOptionKey(record))
      && (!parentIds || parentIds.has(operationalBaseClassId(record))));
    const available = operational.length ? operational.map((record) => {
      const raw = record.option?.trim() || operationalClassOptionKey(record)?.split("::").at(-1) || "";
      return configured.find((name) => optionKey(name) === optionKey(raw)) || raw;
    }) : !selectedClass && scoped.length === 0 ? configured : [];
    for (const raw of available) {
      const name = canonicalSchoolOption(raw);
      if (name) options.set(optionKey(name), name);
    }
  }
  return { classes, options: [...options.values()].sort((a, b) => a.localeCompare(b, "fr")) };
}
