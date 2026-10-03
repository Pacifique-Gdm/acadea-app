import { collection, documentId, getDocs, query, where, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { Expense, FeeType, Payment, Student } from "../types";
import { getStudentFeeSummaries, type StudentFeeSummary } from "../utils/studentFeeSummary";
import { COORDINATION_STUDENT_PAGE_SIZE, loadCoordinationStudentPage, type CoordinationStudentCursor, type CoordinationStudentFilters } from "./coordinationStudentPagination";

export type ControlRow = { student: Student; feeSummaries: StudentFeeSummary[]; balance: { expected: number; paid: number; remaining: number }; progress: number };
export type ControlAmountFilter = { comparator: string; threshold: string };
export type CoordinationControlCursor = { studentCursor?: CoordinationStudentCursor; pending: ControlRow[]; exhausted: boolean };
export type CoordinationControlPage = { rows: ControlRow[]; nextCursor?: CoordinationControlCursor; fetchedStudents: number };

async function bySchools<T>(name: string, schoolIds: readonly string[]): Promise<T[]> {
  if (!db || !schoolIds.length) return [];
  const chunks = Array.from({ length: Math.ceil(schoolIds.length / 30) }, (_, i) => schoolIds.slice(i * 30, i * 30 + 30));
  const snapshots = await Promise.all(chunks.map((ids) => getDocs(query(collection(db as unknown as Firestore, name), where("schoolId", "in", ids)))));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T)));
}

export const loadCoordinationControlFees = (schoolIds: readonly string[]) => bySchools<FeeType>("feeTypes", schoolIds);

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
  if (!filter.comparator || !filter.threshold) return true;
  const threshold = Number(filter.threshold);
  if (!Number.isFinite(threshold)) return true;
  if (filter.comparator === "all-fees-gte") return row.feeSummaries.length > 0 && row.feeSummaries.every((summary) => summary.paid >= threshold);
  if (filter.comparator === "all-fees-lt") return row.feeSummaries.some((summary) => summary.paid < threshold);
  const match = filter.comparator.match(/^fee:(.+):(gte|lt)$/);
  if (!match) return true;
  const summary = row.feeSummaries.find((item) => item.feeTypeId === match[1]);
  return Boolean(summary && (match[2] === "gte" ? summary.paid >= threshold : summary.paid < threshold));
}

export async function loadCoordinationControlPage(filters: CoordinationStudentFilters, fees: FeeType[], amountFilter: ControlAmountFilter, cursor?: CoordinationControlCursor): Promise<CoordinationControlPage> {
  const rows: ControlRow[] = [];
  const pending = [...(cursor?.pending ?? [])];
  let studentCursor = cursor?.studentCursor, exhausted = cursor?.exhausted ?? false, fetchedStudents = 0;
  while (rows.length < COORDINATION_STUDENT_PAGE_SIZE) {
    if (pending.length) { rows.push(pending.shift()!); continue; }
    if (exhausted) break;
    const page = await loadCoordinationStudentPage(filters, studentCursor);
    fetchedStudents += page.fetchedDocuments;
    studentCursor = page.nextCursor; exhausted = !page.nextCursor;
    const payments = await loadControlPagePayments(page.students);
    for (const student of page.students) {
      // The shared fee helper expects a single school/year scope.
      const scopedFees = fees.filter((fee) => fee.schoolId === student.schoolId && fee.schoolYearId === student.schoolYearId);
      const feeSummaries = getStudentFeeSummaries(student, scopedFees, payments);
      const balance = feeSummaries.reduce((total, item) => ({ expected: total.expected + item.expected, paid: total.paid + item.paid, remaining: total.remaining + item.remaining }), { expected: 0, paid: 0, remaining: 0 });
      const row = { student, feeSummaries, balance, progress: balance.expected ? Math.min(100, Math.round(balance.paid / balance.expected * 100)) : 0 };
      if (controlRowMatches(row, amountFilter)) pending.push(row);
    }
  }
  return { rows, fetchedStudents, nextCursor: pending.length || !exhausted ? { pending, studentCursor, exhausted } : undefined };
}

export async function loadCoordinationControlHistory(schoolIds: readonly string[]) {
  const [payments, expenses] = await Promise.all([bySchools<Payment>("payments", schoolIds), bySchools<Expense>("expenses", schoolIds)]);
  const students: Student[] = [];
  if (db) for (const schoolId of schoolIds) {
    const ids = [...new Set(payments.filter((payment) => payment.schoolId === schoolId).map((payment) => payment.studentId))];
    const results = await Promise.all(Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) => getDocs(query(collection(db as unknown as Firestore, "students"), where("schoolId", "==", schoolId), where(documentId(), "in", ids.slice(i * 30, i * 30 + 30))))));
    results.forEach((snapshot) => snapshot.docs.forEach((item) => students.push({ id: item.id, ...item.data() } as Student)));
  }
  return { payments, expenses, students };
}
