import { collection, documentId, getDocs, limit, orderBy, query, startAfter, where, type DocumentData, type Firestore, type QueryConstraint, type QueryDocumentSnapshot } from "@firebase/firestore";
import { db } from "../firebase";
import type { FeeType, Payment, School, SchoolSection, SchoolYear, Student } from "../types";
import { canonicalSchoolOption } from "../utils/schoolOptions";
import { normalizeStudentSearch } from "../utils/studentSearch.js";
import type { CoordinationStudentStatus } from "../utils/coordinationSupervision";

export const COORDINATION_STUDENT_PAGE_SIZE = 50;
export const COORDINATION_ACTIVE_YEAR = "active";
const SOURCE_FETCH_SIZE = 8;

export type CoordinationStudentFilters = {
  schools: readonly School[];
  years: readonly SchoolYear[];
  selectedSchoolId: string;
  selectedYearId: string;
  filterSchoolId: string;
  search: string;
  status: CoordinationStudentStatus;
  className: string;
  option: string;
  allowedSections: readonly SchoolSection[];
};

type SourceState = {
  source: { schoolId: string; schoolYearId: string };
  pending: QueryDocumentSnapshot<DocumentData>[];
  last?: QueryDocumentSnapshot<DocumentData>;
  exhausted: boolean;
};
export type CoordinationStudentCursor = { sortName: string; id: string; sourceStates?: SourceState[] };
export type CoordinationStudentPage = { students: Student[]; nextCursor?: CoordinationStudentCursor; fetchedDocuments: number; queryCount: number };

export function coordinationStudentSources(filters: CoordinationStudentFilters) {
  const allowedSchools = new Map(filters.schools.filter((school) => school.status === "active").map((school) => [school.id, school]));
  return filters.years
    .filter((year) => allowedSchools.has(year.schoolId)
      && (!filters.selectedSchoolId || year.schoolId === filters.selectedSchoolId)
      && (!filters.filterSchoolId || year.schoolId === filters.filterSchoolId)
      && (filters.selectedYearId === COORDINATION_ACTIVE_YEAR ? year.id === allowedSchools.get(year.schoolId)?.activeSchoolYearId : !filters.selectedYearId || year.id === filters.selectedYearId))
    .map((year) => ({ schoolId: year.schoolId, schoolYearId: year.id }));
}

export function coordinationYearChoices(years: readonly SchoolYear[], schools: readonly School[]) {
  const allowed = new Set(schools.map((school) => school.id));
  const active = new Set(schools.map((school) => school.activeSchoolYearId).filter(Boolean));
  return years.filter((year) => allowed.has(year.schoolId)).sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)) || b.startsAt.localeCompare(a.startsAt) || b.name.localeCompare(a.name, "fr") || a.schoolId.localeCompare(b.schoolId) || a.id.localeCompare(b.id));
}

export function coordinationStudentConstraints(filters: CoordinationStudentFilters, source: { schoolId: string; schoolYearId: string }): QueryConstraint[] {
  const constraints: QueryConstraint[] = [where("schoolId", "==", source.schoolId), where("schoolYearId", "==", source.schoolYearId)];
  const sections = [...new Set(filters.allowedSections)];
  if (sections.length === 1) constraints.push(where("section", "==", sections[0]));
  else if (sections.length > 1) constraints.push(where("section", "in", sections.slice(0, 10)));
  if (filters.status !== "all") constraints.push(where("searchArchived", "==", filters.status === "archived"));
  if (filters.className) constraints.push(where("className", "==", filters.className));
  if (filters.option) constraints.push(where("option", "==", canonicalSchoolOption(filters.option)));
  const search = normalizeStudentSearch(filters.search);
  if (search) constraints.push(where("searchPrefixes", "array-contains", search));
  return constraints;
}

function studentFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Student {
  return { id: snapshot.id, ...snapshot.data() } as Student;
}

export async function loadCoordinationStudentYears(schoolIds: readonly string[]): Promise<SchoolYear[]> {
  if (!db || schoolIds.length === 0) return [];
  const database = db as unknown as Firestore;
  const chunks = Array.from({ length: Math.ceil(schoolIds.length / 30) }, (_, index) => schoolIds.slice(index * 30, index * 30 + 30));
  const results = await Promise.all(chunks.map((ids) => getDocs(query(collection(database, "schoolYears"), where("schoolId", "in", ids)))));
  return results.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as SchoolYear)));
}

export async function loadCoordinationStudentFinancialDetails(student: Student): Promise<{ feeTypes: FeeType[]; payments: Payment[] }> {
  if (!db) return { feeTypes: [], payments: [] };
  const database = db as unknown as Firestore;
  const [fees, payments] = await Promise.all([
    getDocs(query(collection(database, "feeTypes"), where("schoolId", "==", student.schoolId), where("schoolYearId", "==", student.schoolYearId))),
    getDocs(query(collection(database, "payments"), where("schoolId", "==", student.schoolId), where("schoolYearId", "==", student.schoolYearId), where("studentId", "==", student.id))),
  ]);
  return {
    feeTypes: fees.docs.map((item) => ({ id: item.id, ...item.data() } as FeeType)),
    payments: payments.docs.map((item) => ({ id: item.id, ...item.data() } as Payment)),
  };
}

export async function loadCoordinationStudentPage(filters: CoordinationStudentFilters, cursor?: CoordinationStudentCursor): Promise<CoordinationStudentPage> {
  if (!db) return { students: [], fetchedDocuments: 0, queryCount: 0 };
  const database = db as unknown as Firestore;
  const sources = coordinationStudentSources(filters);
  const states: SourceState[] = sources.map((source) => {
    const previous = cursor?.sourceStates?.find((state) => state.source.schoolId === source.schoolId && state.source.schoolYearId === source.schoolYearId);
    return previous ? { ...previous, pending: [...previous.pending] } : { source, pending: [], last: undefined, exhausted: false };
  });
  let fetchedDocuments = 0;
  let queryCount = 0;
  async function fill(state: typeof states[number]) {
    if (state.exhausted || state.pending.length) return;
    const snapshot = await getDocs(query(
      collection(database, "students"),
      ...coordinationStudentConstraints(filters, state.source),
      orderBy("sortName"), orderBy(documentId()),
      ...(state.last ? [startAfter(state.last)] : cursor ? [startAfter(cursor.sortName, cursor.id)] : []),
      limit(SOURCE_FETCH_SIZE),
    ));
    state.pending = snapshot.docs;
    state.last = snapshot.docs.at(-1) ?? state.last;
    state.exhausted = snapshot.size < SOURCE_FETCH_SIZE;
    fetchedDocuments += snapshot.size;
    queryCount++;
  }
  function precedes(left: QueryDocumentSnapshot<DocumentData>, right: QueryDocumentSnapshot<DocumentData>) {
    const leftName = String(left.get("sortName") ?? "");
    const rightName = String(right.get("sortName") ?? "");
    return leftName === rightName ? left.id < right.id : leftName < rightName;
  }
  const all: Student[] = [];
  while (all.length < COORDINATION_STUDENT_PAGE_SIZE) {
    await Promise.all(states.map(fill));
    const available = states.filter((state) => state.pending.length);
    if (!available.length) break;
    const first = available.reduce((best, state) => precedes(state.pending[0], best.pending[0]) ? state : best);
    all.push(studentFromSnapshot(first.pending.shift()!));
  }
  // The source batches already fetched beyond this page become the next page's
  // in-memory cursor. Do not fetch those documents a second time.
  await Promise.all(states.map(fill));
  const students = all.slice(0, COORDINATION_STUDENT_PAGE_SIZE);
  const last = students.at(-1);
  return {
    students,
    fetchedDocuments,
    queryCount,
    nextCursor: last && states.some((state) => state.pending.length) ? { sortName: String(last.sortName ?? ""), id: last.id, sourceStates: states } : undefined,
  };
}
