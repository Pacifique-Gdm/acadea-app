// Petit lot « Filles / Garçons » : filtre de l'onglet Élèves (école et Coordination), nombres par choix.
import { beforeEach, describe, expect, it, vi } from "vitest";
import indexes from "../../firestore.indexes.json";

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => name), documentId: vi.fn(() => "__name__"), getCountFromServer: vi.fn(), getDocs: vi.fn(),
  limit: vi.fn((value) => ({ kind: "limit", value })), onSnapshot: vi.fn(), orderBy: vi.fn((field) => ({ kind: "orderBy", field })),
  query: vi.fn((...parts) => ({ parts })), startAfter: vi.fn((cursor) => ({ kind: "cursor", cursor })),
  where: vi.fn((field, op, value) => ({ kind: "where", field, op, value })),
}));
vi.mock("@firebase/firestore", () => mocks);
vi.mock("../firebase", () => ({ db: {} }));

import type { Student } from "../types";
import { countStudentStatuses, countStudentStatusesLocally, filterStudentFallback, studentFilterConstraints, type StudentQueryFilters } from "./studentPagination";
import { coordinationStudentConstraints } from "./coordinationStudentPagination";
import { filterCoordinationStudents } from "../utils/coordinationSupervision";
import { missingSexNotice, studentStatusLabel } from "../hooks/useStudentStatusCounts";

const base: StudentQueryFilters = { schoolId: "s", schoolYearId: "y", search: "", archive: "all", section: "all", className: "", option: "" };
const student = (id: string, sexe: string | undefined, archived = false) => ({ id, schoolId: "s", schoolYearId: "y", nom: id, postnom: "", prenom: "", className: "1ère", sexe,
  status: archived ? "ARCHIVED" : "ACTIVE", searchArchived: archived, searchPrefixes: [], sortName: id } as unknown as Student);
const students = [student("a", "F"), student("b", "F"), student("c", "M"), student("d", undefined), student("e", "F", true)];

describe("filtre Filles / Garçons", () => {
  beforeEach(() => vi.clearAllMocks());
  it("« Filles » et « Garçons » ne montrent que des élèves actifs ; sans sexe : seulement dans Tous et Actifs", () => {
    expect(filterStudentFallback(students, { ...base, archive: "girls" }).map((s) => s.id)).toEqual(["a", "b"]);
    expect(filterStudentFallback(students, { ...base, archive: "boys" }).map((s) => s.id)).toEqual(["c"]);
    expect(filterStudentFallback(students, { ...base, archive: "active" }).map((s) => s.id)).toContain("d");
  });
  it("nombre pour chaque choix et élèves sans sexe signalés", () => {
    const counts = countStudentStatusesLocally(students, base);
    expect(counts).toEqual({ all: 5, active: 4, archived: 1, girls: 2, boys: 1, missingSex: 1 });
    expect(studentStatusLabel("girls", counts)).toBe("Filles (2)");
    expect(missingSexNotice(counts)).toContain("1 élève actif sans sexe renseigné");
    expect(missingSexNotice({ ...counts, missingSex: 0 })).toBe("");
  });
  it("le serveur filtre « actif » et le sexe ; il fonctionne avec la classe, l'option et la recherche", () => {
    studentFilterConstraints({ ...base, archive: "girls", className: "1ère", search: "Ma" });
    expect(mocks.where).toHaveBeenCalledWith("searchArchived", "==", false);
    expect(mocks.where).toHaveBeenCalledWith("sexe", "==", "F");
    expect(mocks.where).toHaveBeenCalledWith("className", "==", "1ère");
    vi.clearAllMocks();
    coordinationStudentConstraints({ status: "boys", search: "", className: "", option: "", allowedSections: [] } as never, { schoolId: "s", schoolYearId: "y" });
    expect(mocks.where).toHaveBeenCalledWith("searchArchived", "==", false);
    expect(mocks.where).toHaveBeenCalledWith("sexe", "==", "M");
  });
  it("quatre comptages seulement (Actifs et « sans sexe » sont déduits)", async () => {
    mocks.getCountFromServer.mockImplementation(async (q: { parts: { field?: string; value?: unknown }[] }) => {
      const sex = q.parts.find((p) => p.field === "sexe")?.value, archived = q.parts.find((p) => p.field === "searchArchived")?.value;
      return { data: () => ({ count: sex === "F" ? 2 : sex === "M" ? 1 : archived === true ? 1 : 5 }) };
    });
    expect(await countStudentStatuses(base)).toEqual({ all: 5, active: 4, archived: 1, girls: 2, boys: 1, missingSex: 1 });
    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(4);
  });
  it("Coordination : même filtre en local", () => {
    const rows = filterCoordinationStudents({ students, selectedSchoolId: "", search: "", status: "girls", classKey: "", optionKey: "" });
    expect(rows.map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("un index Firestore pour chaque combinaison avec le sexe", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }> = [];
      if (mask & 8) fields.push({ fieldPath: "searchPrefixes", arrayConfig: "CONTAINS" });
      if (mask & 2) fields.push({ fieldPath: "className", order: "ASCENDING" });
      if (mask & 1) fields.push({ fieldPath: "option", order: "ASCENDING" });
      fields.push({ fieldPath: "schoolId", order: "ASCENDING" }, { fieldPath: "schoolYearId", order: "ASCENDING" }, { fieldPath: "searchArchived", order: "ASCENDING" }, { fieldPath: "sexe", order: "ASCENDING" });
      if (mask & 4) fields.push({ fieldPath: "section", order: "ASCENDING" });
      fields.push({ fieldPath: "sortName", order: "ASCENDING" }, { fieldPath: "__name__", order: "ASCENDING" });
      expect(indexes.indexes, `Filtres ${mask.toString(2)}`).toContainEqual({ collectionGroup: "students", queryScope: "COLLECTION", fields });
    }
  });
});
