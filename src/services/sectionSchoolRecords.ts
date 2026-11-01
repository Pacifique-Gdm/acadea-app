import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import { sectionAdministratorQuerySections } from "../utils/sectionAdministratorYearScope";
import type { AppUser, School, SchoolYear, SchoolClassRecord, Student, FeeType, Payment } from "../types";
import { loadControlHistoryPage, type ControlHistoryPage } from "./controlHistory";

export async function loadSectionSchoolBootstrap(user: AppUser) {
  const schoolId = user.schoolId ?? "";
  sectionAdministratorQuerySections(user, schoolId);
  const token = await getCurrentFirebaseIdToken();
  if (!token) throw new Error("Authentification requise.");
  const response = await fetch(resolveApiUrl("/api/provision-school-account"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "load-section-school-bootstrap" }),
  });
  if (!response.ok) throw new Error("Chargement initial refusé ou indisponible.");
  const data = await response.json() as { users: AppUser[]; schools: School[]; schoolYears: SchoolYear[] };
  if (!Array.isArray(data.users) || data.users.length !== 1 || data.users[0]?.id !== user.id || data.users[0]?.role !== user.role
      || !Array.isArray(data.schools) || data.schools.length !== 1 || data.schools[0]?.id !== schoolId || data.schools[0]?.status !== "active"
      || !Array.isArray(data.schoolYears) || data.schoolYears.some((year) => year.schoolId !== schoolId)) {
    throw new Error("Réponse initiale hors périmètre.");
  }
  sectionAdministratorQuerySections(data.users[0], schoolId);
  return data;
}

type Records = { classes: SchoolClassRecord; students: Student; feeTypes: FeeType };
export async function loadSectionSchoolRecords<K extends keyof Records>(
  kind: K, user: AppUser, schoolId: string, schoolYearId: string, signal?: AbortSignal,
): Promise<Records[K][]> {
  const sections = sectionAdministratorQuerySections(user, schoolId);
  if (!schoolYearId) throw new Error("Année scolaire requise.");
  const token = await getCurrentFirebaseIdToken();
  if (!token) throw new Error("Authentification requise.");
  const records = new Map<string, Records[K]>();
  const cursors = new Set<string>();
  let cursorId: string | undefined;
  do {
    const response = await fetch(resolveApiUrl("/api/provision-school-account"), {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list-section-school-records", kind, schoolYearId, ...(cursorId ? { cursorId } : {}) }),
    });
    if (!response.ok) throw new Error("Chargement scolaire refusé ou indisponible. Veuillez réessayer.");
    const page = await response.json() as { schoolId: string; schoolYearId: string; items: Records[K][]; nextCursorId: unknown };
    if (page.schoolId !== schoolId || page.schoolYearId !== schoolYearId || !Array.isArray(page.items)
      || page.items.some((item) => !item || typeof item.id !== "string" || item.schoolId !== schoolId
        || item.schoolYearId !== schoolYearId || kind !== "feeTypes"
          && (!("section" in item) || !item.section || !sections.includes(String(item.section))))) {
      throw new Error("Réponse scolaire hors périmètre.");
    }
    for (const item of page.items) records.set(item.id, item);
    if (page.nextCursorId !== null && (typeof page.nextCursorId !== "string" || !page.nextCursorId || cursors.has(page.nextCursorId))) {
      throw new Error("Pagination scolaire invalide.");
    }
    cursorId = page.nextCursorId === null ? undefined : page.nextCursorId as string;
    if (cursorId) cursors.add(cursorId);
  } while (cursorId);
  return [...records.values()];
}

/** No global accounting data is mixed into a section's student balances. */
export async function loadSectionSchoolYear(user: AppUser, schoolYearId: string) {
  const schoolId = user.schoolId ?? "";
  sectionAdministratorQuerySections(user, schoolId);
  const [students, feeTypes] = await Promise.all([
    loadSectionSchoolRecords("students", user, schoolId, schoolYearId),
    loadSectionSchoolRecords("feeTypes", user, schoolId, schoolYearId),
  ]);
  const payments = new Map<string, Payment>();
  const cursors = new Set<string>();
  let cursor: { id: string } | null = null;
  do {
    const page: ControlHistoryPage<Payment> = await loadControlHistoryPage<Payment>("payments", schoolId, schoolYearId, user, cursor);
    for (const payment of page.items) payments.set(payment.id, payment);
    cursor = page.lastVisible ? { id: page.lastVisible.id } : null;
    if (cursor && cursors.has(cursor.id)) throw new Error("Pagination financière invalide.");
    if (cursor) cursors.add(cursor.id);
  } while (cursor);
  return { students, feeTypes, payments: [...payments.values()], parents: [], expenses: [], cashInflows: [],
    messages: [], valves: [], attendance: [], attendanceSettings: [], auditLogs: [] };
}
