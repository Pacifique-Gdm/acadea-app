import { collection, documentId, getCountFromServer, getDocs, limit, orderBy, query, startAfter, where, type DocumentData, type Firestore, type QueryConstraint, type QueryDocumentSnapshot } from "@firebase/firestore";
import { db } from "../firebase";
import type { FeeType, Payment, School, SchoolSection, SchoolYear, Student } from "../types";
import { canonicalSchoolOption } from "../utils/schoolOptions";
import { normalizeStudentSearch } from "../utils/studentSearch.js";
import { isHiddenSchoolYear } from "../utils/schoolYears";
import { schoolYearStartOf } from "../../api/_lib/schoolYearOpening.js";
import type { CoordinationStudentStatus } from "../utils/coordinationSupervision";
import { mapCoordinationSchoolBatches } from "./coordinationSchoolBatches";

export const COORDINATION_STUDENT_PAGE_SIZE = 50;
export const COORDINATION_ACTIVE_YEAR = "active";
/** A coordination year is a period shared by schools, not one school's document ID. */
export function coordinationYearPeriod(year: SchoolYear) {
  const name = (year.name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const standard = name.match(/^(\d{4})\s*[-\u2010-\u2015/]\s*(\d{4})$/);
  const label = standard ? `${standard[1]}-${standard[2]}` : name;
  if (label) return { value: `period:${label.toLocaleLowerCase("fr")}`, label };
  if (year.startsAt && year.endsAt) return { value: `dates:${year.startsAt}:${year.endsAt}`, label: `${year.startsAt} – ${year.endsAt}` };
  return { value: `document:${year.schoolId}:${year.id}`, label: year.id };
}

export function coordinationYearMatches(year: SchoolYear, selectedYearId: string, activeYearId?: string) {
  if (selectedYearId === COORDINATION_ACTIVE_YEAR) return year.id === activeYearId;
  return !selectedYearId || selectedYearId === year.id || selectedYearId === coordinationYearPeriod(year).value;
}
export function coordinationSourceFetchSize(sourceCount: number) {
  return Math.min(16, Math.max(8, Math.ceil(COORDINATION_STUDENT_PAGE_SIZE / Math.max(1, sourceCount))));
}

export type CoordinationStudentFilters = {
  schools: readonly School[];
  years: readonly SchoolYear[];
  selectedSchoolId: string;
  selectedYearId: string;
  filterSchoolId: string;
  search: string;
  status: CoordinationStudentStatus;
  className: string;
  classBranchesBySource?: Record<string, Array<{ name: string; option?: string; operational: boolean }>>;
  option: string;
  allowedSections: readonly SchoolSection[];
};

type CoordinationStudentSource = { schoolId: string; schoolYearId: string; className?: string; skipOptionConstraint?: boolean };
type SourceState = {
  source: CoordinationStudentSource;
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
      && coordinationYearMatches(year, filters.selectedYearId, allowedSchools.get(year.schoolId)?.activeSchoolYearId))
    .flatMap((year): CoordinationStudentSource[] => {
      const source = { schoolId: year.schoolId, schoolYearId: year.id };
      if (!filters.className) return [source];
      const branches = filters.classBranchesBySource?.[`${year.schoolId}::${year.id}`] ?? [{ name: filters.className, operational: false }];
      const selectedOption = canonicalSchoolOption(filters.option);
      const names = new Set<string>();
      return branches.filter((branch) => !selectedOption || !branch.operational || canonicalSchoolOption(branch.option ?? "") === selectedOption)
        .flatMap((branch) => {
          if (names.has(branch.name)) return [];
          names.add(branch.name);
          return [{ ...source, className: branch.name, skipOptionConstraint: Boolean(selectedOption && branch.operational) }];
        });
    });
}

/** Libellé du premier choix, qui suit automatiquement l'année active : « 2026-2027 (année active) ». */
export function coordinationActiveYearLabel(years: readonly SchoolYear[], schools: readonly School[]) {
  const ids = new Set(schools.map((school) => school.activeSchoolYearId).filter(Boolean));
  const labels = [...new Set(years.filter((year) => ids.has(year.id)).map((year) => coordinationYearPeriod(year).label))];
  return labels.length === 1 ? `${labels[0]} (année active)` : labels.length ? `${labels.join(" / ")} (années actives)` : "Année active";
}

export function coordinationYearChoices(years: readonly SchoolYear[], schools: readonly School[]) {
  const allowed = new Set(schools.map((school) => school.id));
  const active = new Set(schools.map((school) => school.activeSchoolYearId).filter(Boolean));
  const choices = new Map<string, ReturnType<typeof coordinationYearPeriod>>();
  // Ordre : de la plus récente à la plus ancienne (d'après le nom) ; années cachées jamais proposées.
  // « Année active » et « Toutes les années » encadrent cette liste dans les écrans.
  const start = (year: SchoolYear) => schoolYearStartOf(year.name) ?? Number((year.startsAt ?? "").slice(0, 4) || 0);
  // L'année active n'est pas répétée ici : elle forme le premier choix « 2026-2027 (année active) ».
  for (const year of years.filter((item) => allowed.has(item.schoolId) && !active.has(item.id) && !isHiddenSchoolYear(item))
    .sort((a, b) => start(b) - start(a) || (b.name ?? "").localeCompare(a.name ?? "", "fr") || a.schoolId.localeCompare(b.schoolId) || a.id.localeCompare(b.id))) {
    const choice = coordinationYearPeriod(year);
    if (!choices.has(choice.value)) choices.set(choice.value, choice);
  }
  return [...choices.values()];
}

export function coordinationStudentConstraints(filters: CoordinationStudentFilters, source: CoordinationStudentSource): QueryConstraint[] {
  const constraints: QueryConstraint[] = [where("schoolId", "==", source.schoolId), where("schoolYearId", "==", source.schoolYearId)];
  const sections = [...new Set(filters.allowedSections)];
  if (sections.length === 1) constraints.push(where("section", "==", sections[0]));
  else if (sections.length > 1) constraints.push(where("section", "in", sections.slice(0, 10)));
  if (filters.status !== "all") constraints.push(where("searchArchived", "==", filters.status === "archived"));
  // « Filles » et « Garçons » : élèves actifs seulement.
  if (filters.status === "girls" || filters.status === "boys") constraints.push(where("sexe", "==", filters.status === "girls" ? "F" : "M"));
  if (source.className || filters.className) constraints.push(where("className", "==", source.className || filters.className));
  const search = normalizeStudentSearch(filters.search);
  // Lot « allègement des index » : avec une recherche, l'option est filtrée après la lecture (voir optionAfterSearch).
  if (filters.option && !source.skipOptionConstraint && !search) constraints.push(where("option", "==", canonicalSchoolOption(filters.option)));
  if (search) constraints.push(where("searchPrefixes", "array-contains", search));
  return constraints;
}

function studentFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Student {
  return { id: snapshot.id, ...snapshot.data() } as Student;
}

/** Avec une recherche, l'option n'est plus dans la requête : elle est vérifiée ici, fiche par fiche. */
export function optionAfterSearch(filters: Pick<CoordinationStudentFilters, "option" | "search">, source: Pick<CoordinationStudentSource, "skipOptionConstraint">) {
  const option = canonicalSchoolOption(filters.option ?? "");
  if (!option || source.skipOptionConstraint || !normalizeStudentSearch(filters.search)) return () => true;
  return (data: DocumentData) => canonicalSchoolOption(String(data.option ?? "")) === option;
}

export async function loadCoordinationStudentYears(schoolIds: readonly string[], isDelegate: boolean): Promise<SchoolYear[]> {
  if (!db || schoolIds.length === 0) return [];
  const database = db as unknown as Firestore;
  const results = await mapCoordinationSchoolBatches(schoolIds, isDelegate, (ids) => getDocs(query(collection(database, "schoolYears"), where("schoolId", "in", ids))));
  // Années cachées (« … (ne pas utiliser) ») : jamais proposées ni lues par « Toutes les années » ; l'année active reste toujours.
  return results.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as SchoolYear))).filter((year) => year.status === "active" || !isHiddenSchoolYear(year));
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
  const sourceFetchSize = coordinationSourceFetchSize(sources.length);
  const states: SourceState[] = sources.map((source) => {
    const previous = cursor?.sourceStates?.find((state) => state.source.schoolId === source.schoolId && state.source.schoolYearId === source.schoolYearId && state.source.className === source.className);
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
      limit(sourceFetchSize),
    ));
    const keep = optionAfterSearch(filters, state.source);
    state.pending = snapshot.docs.filter((item) => keep(item.data()));
    state.last = snapshot.docs.at(-1) ?? state.last;
    state.exhausted = snapshot.size < sourceFetchSize;
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

/** Nombre d'élèves pour chaque choix du filtre de statut (Tous, Actifs, Archivés, Filles, Garçons), toutes écoles
 * du périmètre additionnées ; quatre comptages par source, jamais de lecture des fiches. */
export async function countCoordinationStudentStatuses(filters: CoordinationStudentFilters) {
  const { studentStatusCountsFrom } = await import("./studentPagination");
  if (!db) return studentStatusCountsFrom(0, 0, 0, 0);
  const database = db as unknown as Firestore;
  const sources = coordinationStudentSources(filters);
  const count = async (status: CoordinationStudentStatus) => (await Promise.all(sources.map(async (source) => {
    const keep = optionAfterSearch(filters, source);
    const constraints = coordinationStudentConstraints({ ...filters, status }, source);
    // Recherche + option : on compte les fiches trouvées (peu nombreuses), sans index supplémentaire.
    if (canonicalSchoolOption(filters.option ?? "") && normalizeStudentSearch(filters.search) && !source.skipOptionConstraint) {
      return (await getDocs(query(collection(database, "students"), ...constraints))).docs.filter((item) => keep(item.data())).length;
    }
    return (await getCountFromServer(query(collection(database, "students"), ...constraints))).data().count;
  }))).reduce((n, value) => n + value, 0);
  const [all, archived, girls, boys] = await Promise.all((["all", "archived", "girls", "boys"] as const).map(count));
  return studentStatusCountsFrom(all, archived, girls, boys);
}
