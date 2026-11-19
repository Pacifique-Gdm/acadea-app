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
} from "@firebase/firestore";
import { db } from "../firebase";
import type { SchoolSection, Student } from "../types";
import { canonicalSchoolOption } from "../utils/schoolOptions";
import { getClassSection } from "../utils/studentClasses";
import { compareStudentsAlphabetically, normalizeStudentSearch, studentSearchFields } from "../utils/studentSearch.js";

export const STUDENT_SOURCE_PAGE_SIZE = 50;
/** « Filles » et « Garçons » : élèves actifs seulement (un élève sans sexe renseigné n'est que dans Tous et Actifs). */
export type StudentArchiveFilter = "active" | "archived" | "all" | "girls" | "boys";
export const studentSexOfFilter = (archive: StudentArchiveFilter) => archive === "girls" ? "F" : archive === "boys" ? "M" : null;
export type StudentPageCursor = QueryDocumentSnapshot<DocumentData>;

function studentFirestore() {
  return db as unknown as Firestore | undefined;
}

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
  // Lot « allègement des index » : avec une recherche, l'option est filtrée après (toujours plus étroite qu'une classe) ;
  // cela évite 12 index qui répétaient tous les préfixes de chaque élève.
  if (filters.option && !normalizeStudentSearch(filters.search)) constraints.push(where("option", "==", canonicalSchoolOption(filters.option)));
  if (filters.archive !== "all") constraints.push(where("searchArchived", "==", filters.archive === "archived"));
  const sex = studentSexOfFilter(filters.archive);
  if (sex) constraints.push(where("sexe", "==", sex));
  const search = normalizeStudentSearch(filters.search);
  if (search) constraints.push(where("searchPrefixes", "array-contains", search));
  return constraints;
}

function pageQuery(database: Firestore, filters: StudentQueryFilters, cursor?: StudentPageCursor) {
  return query(
    collection(database, "students"),
    ...studentFilterConstraints(filters),
    orderBy("sortName"),
    orderBy(documentId()),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(STUDENT_SOURCE_PAGE_SIZE),
  );
}

function studentFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Student {
  return { id: snapshot.id, ...snapshot.data() } as Student;
}

/** Avec une recherche, l'option n'est plus dans la requête : elle est vérifiée ici, fiche par fiche. */
export function studentOptionAfterSearch(filters: Pick<StudentQueryFilters, "option" | "search">) {
  const option = canonicalSchoolOption(filters.option ?? "");
  if (!option || !normalizeStudentSearch(filters.search)) return null;
  return (student: Pick<Student, "option">) => canonicalSchoolOption(student.option ?? "") === option;
}

export function subscribeStudentPage(
  filters: StudentQueryFilters,
  cursor: StudentPageCursor | undefined,
  onData: (students: Student[], nextCursor?: StudentPageCursor) => void,
  onError: (error: Error) => void,
) {
  const database = studentFirestore();
  if (!database) return () => undefined;
  return onSnapshot(pageQuery(database, filters, cursor), (snapshot) => {
    const keep = studentOptionAfterSearch(filters);
    const students = snapshot.docs.map(studentFromSnapshot);
    onData(keep ? students.filter(keep) : students, snapshot.docs.at(-1));
  }, onError);
}

export async function countStudentResults(filters: StudentQueryFilters) {
  const database = studentFirestore();
  if (!database) return 0;
  const keep = studentOptionAfterSearch(filters);
  // Recherche + option : on compte les fiches trouvées (peu nombreuses), sans index supplémentaire.
  if (keep) return (await getDocs(query(collection(database, "students"), ...studentFilterConstraints(filters)))).docs.map(studentFromSnapshot).filter(keep).length;
  const result = await getCountFromServer(query(collection(database, "students"), ...studentFilterConstraints(filters)));
  return result.data().count;
}

export async function loadAllStudentResults(filters: StudentQueryFilters, fallbackStudents: Student[] = []) {
  const database = studentFirestore();
  if (!database) return filterStudentFallback(fallbackStudents, filters);
  const snapshot = await getDocs(query(collection(database, "students"), ...studentFilterConstraints(filters), orderBy("sortName"), orderBy(documentId())));
  const keep = studentOptionAfterSearch(filters);
  const students = snapshot.docs.map(studentFromSnapshot);
  return keep ? students.filter(keep) : students;
}

export async function nextStudentMatricule(yearName: string, schoolId: string, schoolYearId: string) {
  const database = studentFirestore();
  if (!database) return "";
  const result = await getCountFromServer(query(
    collection(database, "students"),
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
      && (!studentSexOfFilter(filters.archive) || student.sexe === studentSexOfFilter(filters.archive))
      && (!search || prefixes.includes(search))
      && (filters.section === "all" || section === filters.section)
      && (!filters.className || student.className === filters.className)
      && (!filters.option || canonicalSchoolOption(student.option ?? "") === canonicalSchoolOption(filters.option));
  }).sort(compareStudentsAlphabetically);
}

/** Nombre d'élèves pour chaque choix du filtre de statut, avec les autres filtres (classe, option, recherche).
 * Quatre comptages seulement : Actifs = Tous − Archivés ; sans sexe renseigné = Actifs − Filles − Garçons. */
export type StudentStatusCounts = { all: number; active: number; archived: number; girls: number; boys: number; missingSex: number };
export function studentStatusCountsFrom(all: number, archived: number, girls: number, boys: number): StudentStatusCounts {
  const active = Math.max(0, all - archived);
  return { all, active, archived, girls, boys, missingSex: Math.max(0, active - girls - boys) };
}
export async function countStudentStatuses(filters: StudentQueryFilters): Promise<StudentStatusCounts> {
  const [all, archived, girls, boys] = await Promise.all((["all", "archived", "girls", "boys"] as const).map((archive) => countStudentResults({ ...filters, archive })));
  return studentStatusCountsFrom(all, archived, girls, boys);
}
export function countStudentStatusesLocally(students: Student[], filters: StudentQueryFilters): StudentStatusCounts {
  const count = (archive: StudentArchiveFilter) => filterStudentFallback(students, { ...filters, archive }).length;
  return studentStatusCountsFrom(count("all"), count("archived"), count("girls"), count("boys"));
}
export function countStudentStatusesWithFallback(filters: StudentQueryFilters, fallbackStudents: Student[]) {
  return studentFirestore() ? countStudentStatuses(filters) : Promise.resolve(countStudentStatusesLocally(fallbackStudents, filters));
}
