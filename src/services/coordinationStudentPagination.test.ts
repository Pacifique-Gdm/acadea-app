import { beforeEach, describe, expect, it, vi } from "vitest";
import indexes from "../../firestore.indexes.json";

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => name), documentId: vi.fn(() => "__name__"), getDocs: vi.fn(),
  limit: vi.fn((value) => ({ kind: "limit", value })), orderBy: vi.fn((field) => ({ kind: "orderBy", field })),
  query: vi.fn((...parts) => ({ parts })), startAfter: vi.fn((...values) => ({ kind: "cursor", values })),
  where: vi.fn((field, op, value) => ({ kind: "where", field, op, value })),
}));
vi.mock("@firebase/firestore", () => mocks);
vi.mock("../firebase", () => ({ db: {} }));

import { COORDINATION_ACTIVE_YEAR, COORDINATION_STUDENT_PAGE_SIZE, coordinationStudentConstraints, coordinationStudentSources, coordinationYearChoices, loadCoordinationStudentPage } from "./coordinationStudentPagination";
import type { CoordinationStudentFilters } from "./coordinationStudentPagination";

const school = (id: string, status: "active" | "suspended") => ({ id, status, name: id, address: "", phone: "", email: "", activeSchoolYearId: `year-${id}`, subscriptionPlan: "Starter" as const, subscriptionAmount: 0 });
const year = (id: string, schoolId: string) => ({ id, schoolId, name: id, startsAt: "", endsAt: "", status: "active" as const });
const schools = [school("school-a", "active"), school("school-b", "active"), school("school-out", "suspended")];
const years = [year("year-a", "school-a"), year("year-b", "school-b"), year("year-out", "school-out")];
const filters: CoordinationStudentFilters = { schools, years, selectedSchoolId: "", selectedYearId: "", filterSchoolId: "", search: " Éli ", status: "active", className: "", option: "", allowedSections: ["Primaire"] };
const datasets = {
  "school-a": Array.from({ length: 51 }, (_, i) => `a-${String(i).padStart(3, "0")}`),
  "school-b": Array.from({ length: 20 }, (_, i) => `b-${String(i + 75).padStart(3, "0")}`),
};
function snapshot(ids: string[]) {
  const docs = ids.map((id) => ({ id, get: (field: string) => field === "sortName" ? id.slice(2) : undefined, data: () => ({ schoolId: id.startsWith("a") ? "school-a" : "school-b", sortName: id.slice(2), nom: id }) }));
  return { size: docs.length, docs };
}

describe("pagination serveur Coordination / Sous-coordination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("conserve seulement les couples école/année actifs du périmètre délégué", () => {
    expect(coordinationStudentSources(filters)).toEqual([{ schoolId: "school-a", schoolYearId: "year-a" }, { schoolId: "school-b", schoolYearId: "year-b" }]);
    expect(coordinationStudentSources({ ...filters, selectedSchoolId: "school-a", selectedYearId: "year-a" })).toEqual([{ schoolId: "school-a", schoolYearId: "year-a" }]);
    expect(coordinationStudentSources({ ...filters, filterSchoolId: "school-b" })).toEqual([{ schoolId: "school-b", schoolYearId: "year-b" }]);
    expect(coordinationStudentSources({ ...filters, selectedSchoolId: "school-out" })).toEqual([]);
  });

  it("résout l'année active indépendamment par école, conserve l'historique explicite et trie les choix", () => {
    const oldA = { ...year("old-a", "school-a"), name: "2024-2025", startsAt: "2024-09-01", status: "archived" as const };
    const nextYears = [oldA, { ...years[1], startsAt: "2026-09-01" }, { ...years[0], startsAt: "2025-09-01" }, years[2]];
    const active = { ...filters, schools: schools.slice(0, 2).map((school) => ({ ...school, activeSchoolYearId: school.id === "school-a" ? "year-a" : "year-b" })), years: nextYears, selectedYearId: COORDINATION_ACTIVE_YEAR };
    expect(coordinationStudentSources(active)).toEqual([{ schoolId: "school-b", schoolYearId: "year-b" }, { schoolId: "school-a", schoolYearId: "year-a" }]);
    expect(coordinationStudentSources({ ...active, selectedYearId: "old-a" })).toEqual([{ schoolId: "school-a", schoolYearId: "old-a" }]);
    expect(coordinationStudentSources({ ...active, selectedSchoolId: "school-b", selectedYearId: "old-a" })).toEqual([]);
    expect(coordinationYearChoices([...nextYears, { ...year("future-a", "school-a"), startsAt: "2027-09-01" }], active.schools).map((item) => item.id)).toEqual(["year-b", "year-a", "future-a", "old-a"]);
  });

  it("applique le périmètre et les filtres côté requête, sans chargement global", () => {
    coordinationStudentConstraints(filters, { schoolId: "school-a", schoolYearId: "year-a" });
    expect(mocks.where).toHaveBeenCalledWith("schoolId", "==", "school-a");
    expect(mocks.where).toHaveBeenCalledWith("schoolYearId", "==", "year-a");
    expect(mocks.where).toHaveBeenCalledWith("section", "==", "Primaire");
    expect(mocks.where).toHaveBeenCalledWith("searchArchived", "==", false);
    expect(mocks.where).toHaveBeenCalledWith("searchPrefixes", "array-contains", "eli");
    coordinationStudentConstraints({ ...filters, className: "4ème A", option: "Scientifique", status: "archived" }, { schoolId: "school-a", schoolYearId: "year-a" });
    expect(mocks.where).toHaveBeenCalledWith("className", "==", "4ème A");
    expect(mocks.where).toHaveBeenCalledWith("option", "==", "Sciences");
    expect(mocks.where).toHaveBeenCalledWith("searchArchived", "==", true);
  });

  it.each([7, 50])("termine une source de %i élèves sans inventer une page supplémentaire", async (count) => {
    const ids = datasets["school-a"].slice(0, count);
    mocks.getDocs.mockImplementation(async (request) => {
      const cursor = request.parts.find((part: { kind?: string }) => part.kind === "cursor")?.values;
      const cursorId = cursor?.[0]?.id;
      return snapshot(ids.filter((id) => !cursorId || id > cursorId).slice(0, 8));
    });
    const result = await loadCoordinationStudentPage({ ...filters, schools: [schools[0]], years: [years[0]] });
    expect(result.students).toHaveLength(count);
    expect(result.fetchedDocuments).toBe(count);
    expect(result.nextCursor).toBeUndefined();
  });

  it("utilise les index existants, orderBy, limit et startAfter pour la deuxième page", async () => {
    expect(indexes.indexes).toContainEqual({ collectionGroup: "students", queryScope: "COLLECTION", fields: [
      { fieldPath: "searchPrefixes", arrayConfig: "CONTAINS" }, { fieldPath: "schoolId", order: "ASCENDING" },
      { fieldPath: "schoolYearId", order: "ASCENDING" }, { fieldPath: "searchArchived", order: "ASCENDING" },
      { fieldPath: "section", order: "ASCENDING" }, { fieldPath: "sortName", order: "ASCENDING" }, { fieldPath: "__name__", order: "ASCENDING" },
    ] });
    mocks.getDocs.mockImplementation(async (request) => {
      const schoolId = request.parts.find((part: { kind?: string; field?: string }) => part.kind === "where" && part.field === "schoolId")?.value as keyof typeof datasets;
      const currentCursor = request.parts.find((part: { kind?: string }) => part.kind === "cursor")?.values;
      const cursorId = currentCursor?.length === 2 ? currentCursor[1] : currentCursor?.[0]?.id;
      const ids = datasets[schoolId].filter((id) => !cursorId || id.slice(2) > String(cursorId).slice(2) || (id.slice(2) === String(cursorId).slice(2) && id > cursorId));
      return snapshot(ids.slice(0, 8));
    });
    const first = await loadCoordinationStudentPage(filters);
    const firstCallCount = mocks.getDocs.mock.calls.length;
    expect(first.students).toHaveLength(COORDINATION_STUDENT_PAGE_SIZE);
    expect(first.fetchedDocuments).toBe(59);
    expect(first.queryCount).toBeGreaterThan(2);
    expect(first.nextCursor).toMatchObject({ sortName: "049", id: "a-049" });
    expect(mocks.limit).toHaveBeenCalledWith(8);
    expect(mocks.orderBy).toHaveBeenCalledWith("sortName");
    expect(mocks.orderBy).toHaveBeenCalledWith("__name__");
    const second = await loadCoordinationStudentPage(filters, first.nextCursor);
    expect(second.fetchedDocuments).toBe(12);
    expect(second.queryCount).toBe(2);
    const readIds = (calls: typeof mocks.getDocs.mock.calls) => calls.flatMap(([request]) => {
      const schoolId = request.parts.find((part: { kind?: string; field?: string }) => part.kind === "where" && part.field === "schoolId")?.value as keyof typeof datasets;
      const currentCursor = request.parts.find((part: { kind?: string }) => part.kind === "cursor")?.values;
      const cursorId = currentCursor?.length === 2 ? currentCursor[1] : currentCursor?.[0]?.id;
      return datasets[schoolId].filter((id) => !cursorId || id.slice(2) > String(cursorId).slice(2) || (id.slice(2) === String(cursorId).slice(2) && id > cursorId)).slice(0, 8);
    });
    expect(readIds(mocks.getDocs.mock.calls.slice(firstCallCount)).filter((id) => readIds(mocks.getDocs.mock.calls.slice(0, firstCallCount)).includes(id))).toEqual([]);
    expect(mocks.startAfter).toHaveBeenCalledWith(expect.objectContaining({ id: "b-082" }));
    expect(second.students.map((item) => item.id)).toEqual(["a-050", ...datasets["school-b"]]);
    expect(second.nextCursor).toBeUndefined();
  });
});
