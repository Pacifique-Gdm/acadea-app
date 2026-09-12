import {
  collection,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import type { SchoolSection, Student } from "../types";
import { canonicalSchoolOption } from "../utils/schoolOptions";
import { getClassSection } from "../utils/studentClasses";
import { normalizeStudentSearch, studentSearchFields } from "../utils/studentSearch.js";

export const STUDENT_SOURCE_PAGE_SIZE = 50;
export type StudentArchiveFilter = "active" | "archived" | "all";
export type StudentPageCursor = QueryDocumentSnapshot<DocumentData>;

export interface StudentQueryFilters {
  schoolId: string;
  schoolYearId: string;
  search: string;
  archive: StudentArchiveFilter;
  section: "all" | SchoolSection;
  className: string;
  option: string;
  allowedSections?: readonly SchoolSection[];
}

function normalizedAllowedSections(filters: StudentQueryFilters) {
  return [...new Set(filters.allowedSections ?? [])].sort();
}

export function studentQueryKey(filters: StudentQueryFilters) {
  return JSON.stringify({ ...filters, search: normalizeStudentSearch(filters.search), allowedSections: normalizedAllowedSections(filters) });
}

export function studentFilterConstraints(filters: StudentQueryFilters): QueryConstraint[] {
  const constraints: QueryConstraint[] = [
    where("schoolId", "==", filters.schoolId),
    where("schoolYearId", "==", filters.schoolYearId),
  ];
  const allowedSections = normalizedAllowedSections(filters);
  if (filters.section !== "all") {
    if (allowedSections.length && !allowedSections.includes(filters.section)) return [...constraints, where("section", "==", "__unauthorized__")];
    constraints.push(where("section", "==", filters.section));
  } else if (allowedSections.length === 1) {
    constraints.push(where("section", "==", allowedSections[0]));
  } else if (allowedSections.length > 1) {
    constraints.push(where("section", "in", allowedSections.slice(0, 10)));
  }
  if (filters.className) constraints.push(where("className", "==", filters.className));
  if (filters.option) constraints.push(where("option", "==", canonicalSchoolOption(filters.option)));
  if (filters.archive !== "all") constraints.push(where("searchArchived", "==", filters.archive === "archived"));
  const search = normalizeStudentSearch(filters.search);
  if (search) constraints.push(where("searchPrefixes", "array-contains", search));
  return constraints;
}

function pageQuery(database: Firestore, filters: StudentQueryFilters, cursor?: StudentPageCursor) {
  return query(
    collection(database, "students"),
    ...studentFilterConstraints(filters),
    orderBy(documentId()),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(STUDENT_SOURCE_PAGE_SIZE),
  );
}

function studentFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Student {
  return { id: snapshot.id, ...snapshot.data() } as Student;
}

export function subscribeStudentPage(
  filters: StudentQueryFilters,
  cursor: StudentPageCursor | undefined,
  onData: (students: Student[], nextCursor?: StudentPageCursor) => void,
  onError: (error: Error) => void,
) {
  if (!db) return () => undefined;
  return onSnapshot(pageQuery(db, filters, cursor), (snapshot) => {
    onData(snapshot.docs.map(studentFromSnapshot), snapshot.docs.at(-1));
  }, onError);
}

export async function countStudentResults(filters: StudentQueryFilters) {
  if (!db) return 0;
  const result = await getCountFromServer(query(collection(db, "students"), ...studentFilterConstraints(filters)));
  return result.data().count;
}

export async function loadAllStudentResults(filters: StudentQueryFilters, fallbackStudents: Student[] = []) {
  if (!db) return filterStudentFallback(fallbackStudents, filters);
  const snapshot = await getDocs(query(collection(db, "students"), ...studentFilterConstraints(filters), orderBy(documentId())));
  return snapshot.docs.map(studentFromSnapshot);
}

export async function nextStudentMatricule(yearName: string, schoolId: string, schoolYearId: string) {
  if (!db) return "";
  const result = await getCountFromServer(query(
    collection(db, "students"),
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
  ));
  return `ACD-${yearName.slice(2, 4)}-${String(result.data().count + 1).padStart(4, "0")}`;
}

export function filterStudentFallback(students: Student[], filters: StudentQueryFilters) {
  const allowed = new Set(filters.allowedSections ?? []);
  const search = normalizeStudentSearch(filters.search);
  return students.filter((student) => {
    const archived = student.searchArchived ?? studentSearchFields(student).searchArchived;
    const prefixes = student.searchPrefixes ?? studentSearchFields(student).searchPrefixes;
    const section = student.section ?? getClassSection(student.className);
    return student.schoolId === filters.schoolId
      && student.schoolYearId === filters.schoolYearId
      && (!allowed.size || allowed.has(section))
      && (filters.archive === "all" || archived === (filters.archive === "archived"))
      && (!search || prefixes.includes(search))
      && (filters.section === "all" || section === filters.section)
      && (!filters.className || student.className === filters.className)
      && (!filters.option || canonicalSchoolOption(student.option ?? "") === canonicalSchoolOption(filters.option));
  }).sort((left, right) => left.id.localeCompare(right.id));
}
