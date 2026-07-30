import type { SchoolSection, Student } from "../../types";
import type { StudentMedicalRecord } from "./secretaryTypes";
import { getMedicalRecordStatus } from "../../services/studentMedicalRecords";
import { formatStudentClassName, getStudentSection } from "../../utils/studentClasses";
import { getValveStudentClassKey } from "../../utils/valves";
import { schoolSectionLabels, schoolSectionOrder } from "../../utils/schoolConfig";

export type SecretaryStatisticsFilter =
  | { type: "all" }
  | { type: "section"; section: SchoolSection; label: string }
  | { type: "class"; classKey: string; label: string };

export interface SecretaryStatisticsRow {
  order: number;
  section: string;
  className?: string;
  option?: string;
  count: number;
  percentage: number;
}

function normalizeAcademicLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function recognizedSection(value: string) {
  const normalized = normalizeAcademicLabel(value);
  return schoolSectionOrder.find((section) => normalized.includes(section)) ?? "";
}

function romanToNumber(value: string) {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let index = 0; index < value.length; index += 1) total += (values[value[index]] ?? 0) < (values[value[index + 1]] ?? 0) ? -(values[value[index]] ?? 0) : values[value[index]] ?? 0;
  return total;
}

function academicRank(value: string) {
  const normalized = normalizeAcademicLabel(value);
  const arabic = normalized.match(/\d+/)?.[0];
  if (arabic) return Number(arabic);
  const roman = normalized.match(/\b([ivxlcdm]+)(?:re|ere|e|eme)?\b/)?.[1];
  return roman ? romanToNumber(roman) : Number.MAX_SAFE_INTEGER;
}

export function compareAcademicClasses(first: { section: string; label: string; originalIndex?: number }, second: { section: string; label: string; originalIndex?: number }) {
  const firstSection = recognizedSection(first.section || first.label);
  const secondSection = recognizedSection(second.section || second.label);
  const firstSectionIndex = firstSection ? schoolSectionOrder.indexOf(firstSection) : schoolSectionOrder.length;
  const secondSectionIndex = secondSection ? schoolSectionOrder.indexOf(secondSection) : schoolSectionOrder.length;
  if (firstSectionIndex !== secondSectionIndex) return firstSectionIndex - secondSectionIndex;
  const rankDifference = academicRank(first.label) - academicRank(second.label);
  if (rankDifference !== 0) return rankDifference;
  if (!firstSection && !secondSection) return (first.originalIndex ?? 0) - (second.originalIndex ?? 0);
  return first.label.localeCompare(second.label, "fr", { sensitivity: "base" }) || (first.originalIndex ?? 0) - (second.originalIndex ?? 0);
}

export function filterSecretaryStatisticsStudents(students: Student[], filter: SecretaryStatisticsFilter) {
  if (filter.type === "section") return students.filter((student) => getStudentSection(student) === filter.section);
  if (filter.type === "class") return students.filter((student) => getValveStudentClassKey(student) === filter.classKey);
  return students;
}

export function buildSecretaryStatistics(students: Student[], records: StudentMedicalRecord[]) {
  const uniqueStudents = Array.from(new Map(students.map((student) => [student.id, student])).values());
  const recordsByStudent = new Map(records.map((record) => [record.studentId, record]));
  const statuses = uniqueStudents.map((student) => getMedicalRecordStatus(recordsByStudent.get(student.id)));
  const byClass = uniqueStudents.reduce<Record<string, number>>((result, student) => ({ ...result, [formatStudentClassName(student)]: (result[formatStudentClassName(student)] ?? 0) + 1 }), {});
  const byLevel = uniqueStudents.reduce<Record<string, number>>((result, student) => { const level = getStudentSection(student); return { ...result, [level]: (result[level] ?? 0) + 1 }; }, {});
  const classGroups = Array.from(uniqueStudents.reduce<Map<string, { section: string; className: string; option: string; count: number; originalIndex: number }>>((result, student, originalIndex) => {
    const className = student.className;
    const section = getStudentSection(student);
    const option = student.option?.trim() || "";
    const key = JSON.stringify([section, className, option]);
    const current = result.get(key);
    result.set(key, current ? { ...current, count: current.count + 1 } : { section, className, option, count: 1, originalIndex });
    return result;
  }, new Map()).values()).sort((first, second) => {
    const classDifference = compareAcademicClasses({ section: first.section, label: first.className }, { section: second.section, label: second.className });
    return classDifference || first.option.localeCompare(second.option, "fr", { sensitivity: "base" }) || first.originalIndex - second.originalIndex;
  });
  const sectionGroups = Array.from(uniqueStudents.reduce<Map<string, { section: string; count: number; originalIndex: number }>>((result, student, originalIndex) => {
    const section = getStudentSection(student);
    const current = result.get(section);
    result.set(section, current ? { ...current, count: current.count + 1 } : { section, count: 1, originalIndex });
    return result;
  }, new Map()).values()).sort((first, second) => compareAcademicClasses({ section: first.section, label: first.section, originalIndex: first.originalIndex }, { section: second.section, label: second.section, originalIndex: second.originalIndex }));
  const percentage = (count: number) => uniqueStudents.length ? Number(((count / uniqueStudents.length) * 100).toFixed(2)) : 0;
  const sectionLabel = (section: string) => section in schoolSectionLabels ? schoolSectionLabels[section as SchoolSection] : section || "Non classée";
  return {
    cards: [
      ["Total élèves", uniqueStudents.length], ["Garçons", uniqueStudents.filter((student) => student.sexe === "M").length], ["Filles", uniqueStudents.filter((student) => student.sexe === "F").length],
      ["Fiches complètes", statuses.filter((status) => status === "complete").length], ["Fiches incomplètes", statuses.filter((status) => status === "incomplete").length], ["Fiches non créées", statuses.filter((status) => status === "missing").length],
    ] as Array<[string, number]>,
    byClass,
    byLevel,
    classRows: classGroups.map((row, index): SecretaryStatisticsRow => ({ order: index + 1, section: sectionLabel(row.section), className: row.className, option: row.option || "—", count: row.count, percentage: percentage(row.count) })),
    sectionRows: sectionGroups.map((row, index): SecretaryStatisticsRow => ({ order: index + 1, section: sectionLabel(row.section), count: row.count, percentage: percentage(row.count) })),
  };
}

export function secretaryStatisticsScopeLabel(filter: SecretaryStatisticsFilter) {
  if (filter.type === "section") return `PORTÉE : SECTION — ${filter.label}`;
  if (filter.type === "class") return `PORTÉE : CLASSE — ${filter.label}`;
  return "PORTÉE : STATISTIQUES GLOBALES";
}
