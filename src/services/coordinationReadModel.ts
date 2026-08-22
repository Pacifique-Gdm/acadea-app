import { collection, getDocs, limit, query, startAfter, where, type Firestore, type QueryDocumentSnapshot } from "@firebase/firestore";
import { db } from "../firebase";
import type { AppUser, AuditLog, Expense, FeeType, Payment, SchoolYear, Student } from "../types";
import { isInternalPersonnel } from "./personnel";

export type CoordinationReadModel = { feeTypes: FeeType[]; payments: Payment[]; expenses: Expense[]; personnel: AppUser[]; schoolYears: SchoolYear[]; auditLogs: AuditLog[] };
export type CoordinationDashboardReadModel = { students: Student[]; feeTypes: FeeType[]; payments: Payment[]; expenses: Expense[]; personnel: AppUser[]; schoolYears: SchoolYear[] };
const emptyModel = (): CoordinationReadModel => ({ feeTypes: [], payments: [], expenses: [], personnel: [], schoolYears: [], auditLogs: [] });
const emptyDashboardModel = (): CoordinationDashboardReadModel => ({ students: [], feeTypes: [], payments: [], expenses: [], personnel: [], schoolYears: [] });

async function loadBySchools<T>(name: string, schoolIds: string[]) {
  if (!db || schoolIds.length === 0) return [];
  const database = db as unknown as Firestore;
  const rows: T[] = [];
  for (let index = 0; index < schoolIds.length; index += 30) {
    let cursor: QueryDocumentSnapshot | undefined;
    do {
      const snapshot = await getDocs(query(collection(database, name), where("schoolId", "in", schoolIds.slice(index, index + 30)), ...(cursor ? [startAfter(cursor)] : []), limit(500)));
      snapshot.docs.forEach((item) => rows.push({ id: item.id, ...item.data() } as T));
      cursor = snapshot.docs.at(-1);
      if (snapshot.docs.length < 500) break;
    } while (cursor);
  }
  return rows;
}

export async function loadCoordinationReadModel(coordinationId: string, schoolIds: string[], subCoordinationId?: string): Promise<CoordinationReadModel> {
  if (!db || !coordinationId) return emptyModel();
  const database = db as unknown as Firestore;
  const [feeTypes, payments, expenses, personnel, schoolYears, schoolAudit, coordinationAudit] = await Promise.all([
    loadBySchools<FeeType>("feeTypes", schoolIds), loadBySchools<Payment>("payments", schoolIds), loadBySchools<Expense>("expenses", schoolIds), loadBySchools<AppUser>("users", schoolIds), loadBySchools<SchoolYear>("schoolYears", schoolIds), loadBySchools<AuditLog>("auditLogs", schoolIds), getDocs(query(collection(database, "auditLogs"), where(subCoordinationId ? "subCoordinationId" : "coordinationId", "==", subCoordinationId ?? coordinationId))),
  ]);
  const audit = new Map<string, AuditLog>();
  schoolAudit.forEach((item) => audit.set(item.id, item));
  coordinationAudit.docs.forEach((item) => audit.set(item.id, { id: item.id, ...item.data() } as AuditLog));
  return { feeTypes, payments, expenses, personnel: personnel.filter(isInternalPersonnel), schoolYears, auditLogs: [...audit.values()] };
}

export async function loadCoordinationDashboardReadModel(schoolIds: string[]): Promise<CoordinationDashboardReadModel> {
  if (!db || schoolIds.length === 0) return emptyDashboardModel();
  const [students, feeTypes, payments, expenses, personnel, schoolYears] = await Promise.all([
    loadBySchools<Student>("students", schoolIds),
    loadBySchools<FeeType>("feeTypes", schoolIds),
    loadBySchools<Payment>("payments", schoolIds),
    loadBySchools<Expense>("expenses", schoolIds),
    loadBySchools<AppUser>("users", schoolIds),
    loadBySchools<SchoolYear>("schoolYears", schoolIds),
  ]);
  return { students, feeTypes, payments, expenses, personnel: personnel.filter(isInternalPersonnel), schoolYears };
}
