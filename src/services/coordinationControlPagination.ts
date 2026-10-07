import { collection, documentId, getDocs, query, where, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { Expense, FeeType, Payment, School, Student } from "../types";
import { getStudentFeeSummaries, type StudentFeeSummary } from "../utils/studentFeeSummary";
import { buildControlFeeGroups } from "../utils/controlFilters";
import { COORDINATION_STUDENT_PAGE_SIZE, loadCoordinationStudentPage, type CoordinationStudentCursor, type CoordinationStudentFilters } from "./coordinationStudentPagination";
import { loadCoordinationStudentArrearsBatch } from "./coordinationService";
import { arrearsFilterActive, emptyArrearsFilter, matchesArrearsFilter, type ArrearsFilter, type ArrearsTotals } from "../utils/arrearsFilter";
import { mapCoordinationSchoolBatches } from "./coordinationSchoolBatches";

export type ControlRow = { student: Student; feeSummaries: StudentFeeSummary[]; balance: { expected: number; paid: number; remaining: number }; progress: number };
export type ControlAmountFilter = { comparator: string; threshold: string };
export type CoordinationControlCursor = { studentCursor?: CoordinationStudentCursor; pending: ControlRow[]; exhausted: boolean };
export type CoordinationControlPage = { rows: ControlRow[]; nextCursor?: CoordinationControlCursor; fetchedStudents: number };

async function bySchools<T>(name: string, schoolIds: readonly string[], isDelegate: boolean): Promise<T[]> {
  if (!db || !schoolIds.length) return [];
  const snapshots = await mapCoordinationSchoolBatches(schoolIds, isDelegate, (ids) => getDocs(query(collection(db as unknown as Firestore, name), where("schoolId", "in", ids))));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T)));
}

export const loadCoordinationControlFees = (schoolIds: readonly string[], isDelegate: boolean) => bySchools<FeeType>("feeTypes", schoolIds, isDelegate);

export function buildCoordinationAmountOptions(schools: Pick<School, "id" | "name">[], fees: FeeType[]) {
  return schools.flatMap((school) => {
    const prefix = `school:${encodeURIComponent(school.id)}`;
    const groups = buildControlFeeGroups(fees.filter((fee) => fee.schoolId === school.id), "");
    return [
      { value: `${prefix}:all-fees:gte`, label: `Tous les frais — ${school.name} ≥` },
      { value: `${prefix}:all-fees:lt`, label: `Tous les frais — ${school.name} <` },
      ...groups.flatMap((group) => [
        { value: `${prefix}:fee:${encodeURIComponent(group.key)}:gte`, label: `${group.name} — ${school.name} ≥` },
        { value: `${prefix}:fee:${encodeURIComponent(group.key)}:lt`, label: `${group.name} — ${school.name} <` },
      ]),
      { value: `${prefix}:arrears:gte`, label: `Arriérés — ${school.name} ≥` },
      { value: `${prefix}:arrears:lt`, label: `Arriérés — ${school.name} <` },
    ];
  });
}

export async function loadControlPagePayments(students: readonly Student[]): Promise<Payment[]> {
  if (!db || !students.length) return [];
  const groups = new Map<string, Student[]>();
  for (const student of students) {
    const key = `${student.schoolId}:${student.schoolYearId}`;
    groups.set(key, [...(groups.get(key) ?? []), student]);
  }
  const requests = [...groups.values()].flatMap((group) => Array.from({ length: Math.ceil(group.length / 30) }, (_, i) => {
    const ids = group.slice(i * 30, i * 30 + 30).map((student) => student.id);
    return getDocs(query(collection(db as unknown as Firestore, "payments"), where("schoolId", "==", group[0].schoolId), where("schoolYearId", "==", group[0].schoolYearId), where("studentId", "in", ids)));
  }));
  return (await Promise.all(requests)).flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Payment)));
}

export function controlRowMatches(row: ControlRow, filter: ControlAmountFilter) {
  let comparator = filter.comparator;
  if (comparator.startsWith("school:")) {
    const scoped = comparator.match(/^school:([^:]+):(all-fees|arrears|fee:([^:]+)):(gte|lt)$/);
    if (!scoped || decodeURIComponent(scoped[1]) !== row.student.schoolId) return false;
    comparator = scoped[2] === "all-fees" ? `all-fees-${scoped[4]}` : scoped[2] === "arrears" ? `arrears-${scoped[4]}` : `fee:${decodeURIComponent(scoped[3])}:${scoped[4]}`;
  }
  if (!comparator || !filter.threshold || comparator.startsWith("arrears-")) return true;
  const threshold = Number(filter.threshold);
  if (!Number.isFinite(threshold) || threshold < 0) return true;
  if (comparator === "all-fees-gte") return row.feeSummaries.length > 0 && row.feeSummaries.every((summary) => summary.paid >= threshold);
  if (comparator === "all-fees-lt") return row.feeSummaries.some((summary) => summary.paid < threshold);
  const match = comparator.match(/^fee:(.+):(gte|lt)$/);
  if (!match) return true;
  const summaries = row.feeSummaries.filter((item) => item.feeName.trim().toLowerCase() === match[1] || item.feeTypeId === match[1]);
  if (!summaries.length) return false;
  const paid = summaries.reduce((sum, summary) => sum + summary.paid, 0);
  return match[2] === "gte" ? paid >= threshold : paid < threshold;
}

export async function loadCoordinationControlPage(filters: CoordinationStudentFilters, fees: FeeType[], amountFilter: ControlAmountFilter, cursor?: CoordinationControlCursor, arrearsFilter: ArrearsFilter = emptyArrearsFilter): Promise<CoordinationControlPage> {
  const rows: ControlRow[] = [];
  const pending = [...(cursor?.pending ?? [])];
  let studentCursor = cursor?.studentCursor, exhausted = cursor?.exhausted ?? false, fetchedStudents = 0;
  while (rows.length < COORDINATION_STUDENT_PAGE_SIZE) {
    if (pending.length) { rows.push(pending.shift()!); continue; }
    if (exhausted) break;
    const page = await loadCoordinationStudentPage(filters, studentCursor);
    fetchedStudents += page.fetchedDocuments;
    studentCursor = page.nextCursor; exhausted = !page.nextCursor;
    const [payments, arrears] = await Promise.all([
      loadControlPagePayments(page.students),
      arrearsFilterActive(arrearsFilter) && page.students.length ? loadCoordinationStudentArrearsBatch(page.students.map((student) => student.id)) : Promise.resolve<ArrearsTotals>({}),
    ]);
    for (const student of page.students) {
      // The shared fee helper expects a single school/year scope.
      const scopedFees = fees.filter((fee) => fee.schoolId === student.schoolId && fee.schoolYearId === student.schoolYearId);
      const feeSummaries = getStudentFeeSummaries(student, scopedFees, payments);
      const balance = feeSummaries.reduce((total, item) => ({ expected: total.expected + item.expected, paid: total.paid + item.paid, remaining: total.remaining + item.remaining }), { expected: 0, paid: 0, remaining: 0 });
      const row = { student, feeSummaries, balance, progress: balance.expected ? Math.min(100, Math.round(balance.paid / balance.expected * 100)) : 0 };
      const school = filters.schools.find((item) => item.id === student.schoolId);
      if (school && controlRowMatches(row, amountFilter) && matchesArrearsFilter(arrears[student.id], arrearsFilter, school)) pending.push(row);
    }
  }
  return { rows, fetchedStudents, nextCursor: pending.length || !exhausted ? { pending, studentCursor, exhausted } : undefined };
}

export async function loadCoordinationControlHistory(schoolIds: readonly string[], isDelegate: boolean) {
  const [payments, expenses] = await Promise.all([bySchools<Payment>("payments", schoolIds, isDelegate), bySchools<Expense>("expenses", schoolIds, isDelegate)]);
  const students: Student[] = [];
  if (db) for (const schoolId of schoolIds) {
    const ids = [...new Set(payments.filter((payment) => payment.schoolId === schoolId).map((payment) => payment.studentId))];
    const results = await Promise.all(Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) => getDocs(query(collection(db as unknown as Firestore, "students"), where("schoolId", "==", schoolId), where(documentId(), "in", ids.slice(i * 30, i * 30 + 30))))));
    results.forEach((snapshot) => snapshot.docs.forEach((item) => students.push({ id: item.id, ...item.data() } as Student)));
  }
  return { payments, expenses, students };
}
