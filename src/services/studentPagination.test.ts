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

import { filterStudentFallback, studentFilterConstraints, studentQueryKey, subscribeStudentPage } from "./studentPagination";

const filters = { schoolId: "school-a", schoolYearId: "year-a", search: " Él ", archive: "active" as const, section: "Primaire" as const, className: "1ère Primaire", option: "", allowedSections: ["Primaire"] as const };

describe("pagination source des élèves", () => {
  beforeEach(() => vi.clearAllMocks());

  it("déclare l’index composite nécessaire à la première page active triée globalement", () => {
    expect(indexes.indexes).toContainEqual({
      collectionGroup: "students",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "schoolId", order: "ASCENDING" },
        { fieldPath: "schoolYearId", order: "ASCENDING" },
        { fieldPath: "searchArchived", order: "ASCENDING" },
        { fieldPath: "sortName", order: "ASCENDING" },
        { fieldPath: "__name__", order: "ASCENDING" },
      ],
    });
  });

  it("déclare les index demandés pour chaque combinaison de filtres paginés", () => {
    for (let mask = 0; mask < 32; mask += 1) {
      const fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }> = [];
      if (mask & 8) fields.push({ fieldPath: "searchPrefixes", arrayConfig: "CONTAINS" });
      if (mask & 2) fields.push({ fieldPath: "className", order: "ASCENDING" });
      if (mask & 1) fields.push({ fieldPath: "option", order: "ASCENDING" });
      fields.push({ fieldPath: "schoolId", order: "ASCENDING" }, { fieldPath: "schoolYearId", order: "ASCENDING" });
      if (mask & 16) fields.push({ fieldPath: "searchArchived", order: "ASCENDING" });
      if (mask & 4) fields.push({ fieldPath: "section", order: "ASCENDING" });
      fields.push({ fieldPath: "sortName", order: "ASCENDING" }, { fieldPath: "__name__", order: "ASCENDING" });
      expect(indexes.indexes, `Filtres élèves ${mask.toString(2).padStart(5, "0")}`).toContainEqual({
        collectionGroup: "students",
        queryScope: "COLLECTION",
        fields,
      });
    }
  });

  it("construit une requête tenant/année avec filtres et préfixe normalisé", () => {
    studentFilterConstraints(filters);
    expect(mocks.where).toHaveBeenCalledWith("schoolId", "==", "school-a");
    expect(mocks.where).toHaveBeenCalledWith("schoolYearId", "==", "year-a");
    expect(mocks.where).toHaveBeenCalledWith("section", "==", "Primaire");
    expect(mocks.where).toHaveBeenCalledWith("className", "==", "1ère Primaire");
    expect(mocks.where).toHaveBeenCalledWith("searchArchived", "==", false);
    expect(mocks.where).toHaveBeenCalledWith("searchPrefixes", "array-contains", "el");
  });

  it("produit une clé stable pour les sections autorisées", () => {
    expect(studentQueryKey({ ...filters, allowedSections: ["Primaire", "CTEB"] })).toBe(studentQueryKey({ ...filters, allowedSections: ["CTEB", "Primaire"] }));
  });

  it("pagine globalement sur la clé alphabétique canonique avant l’identifiant", () => {
    subscribeStudentPage(filters, undefined, vi.fn(), vi.fn());
    expect(mocks.orderBy).toHaveBeenCalledWith("sortName");
    expect(mocks.orderBy).toHaveBeenCalledWith("__name__");
  });

  it("trouve hors première page par préfixe, avec accents normalisés", () => {
    const students = Array.from({ length: 80 }, (_, index) => ({ id: `s-${String(index).padStart(3, "0")}`, schoolId: "school-a", schoolYearId: "year-a", matricule: `ACD-${index}`, nom: index === 79 ? "Élise" : `Nom${index}`, postnom: "", prenom: "Test", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" })) as never[];
    expect(filterStudentFallback(students, { ...filters, className: "", search: "eli" }).map((item) => item.id)).toEqual(["s-079"]);
  });

  it.each([120, 520, 1020])("retrouve tous les fragments partagés sur %i élèves et conserve la requête Firestore paginée", (count) => {
    const students = Array.from({ length: count }, (_, index) => ({
      id: `s-${String(index).padStart(4, "0")}`,
      schoolId: "school-a",
      schoolYearId: "year-a",
      matricule: index >= count - 2 ? `ACD-2027-58${index}` : `ROW-${index.toString(36).replace(/5/g, "v").replace(/8/g, "y")}`,
      nom: `Nom${index}`,
      prenom: "Test",
      className: "1ère Primaire",
      section: "Primaire",
      status: "ACTIVE",
    })) as never[];

    subscribeStudentPage({ ...filters, className: "", search: "394" }, undefined, vi.fn(), vi.fn());
    expect(mocks.where).toHaveBeenCalledWith("searchPrefixes", "array-contains", "394");
    expect(mocks.limit).toHaveBeenCalledWith(50);
    expect(filterStudentFallback(students, { ...filters, className: "", search: "58" }).map((item) => item.id)).toEqual([
      `s-${String(count - 2).padStart(4, "0")}`,
      `s-${String(count - 1).padStart(4, "0")}`,
    ]);
  });

  it("retourne tous les élèves partageant un fragment interne sans casser nom ou prénom", () => {
    const students = [
      { id: "s-1", schoolId: "school-a", schoolYearId: "year-a", matricule: "ACD-2027-583942", nom: "Kabuya", prenom: "Alice", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" },
      { id: "s-2", schoolId: "school-a", schoolYearId: "year-a", matricule: "ACD-2027-005812", nom: "Ilunga", prenom: "Benoît", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" },
      { id: "s-3", schoolId: "school-a", schoolYearId: "year-a", matricule: "ACD-2027-004200", nom: "Élise", prenom: "Chantal", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" },
    ] as never[];
    const base = { ...filters, className: "" };
    expect(filterStudentFallback(students, { ...base, search: "58" }).map((item) => item.id)).toEqual(["s-2", "s-1"]);
    expect(filterStudentFallback(students, { ...base, search: "394" }).map((item) => item.id)).toEqual(["s-1"]);
    expect(filterStudentFallback(students, { ...base, search: "eli" }).map((item) => item.id)).toEqual(["s-3"]);
  });

  it("trie aussi le fallback globalement par nom, postnom puis prénom", () => {
    const students = [
      { id: "s-3", schoolId: "school-a", schoolYearId: "year-a", matricule: "3", nom: "Zulu", postnom: "", prenom: "A", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" },
      { id: "s-2", schoolId: "school-a", schoolYearId: "year-a", matricule: "2", nom: "Alpha", postnom: "B", prenom: "A", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" },
      { id: "s-1", schoolId: "school-a", schoolYearId: "year-a", matricule: "1", nom: "Alpha", postnom: "A", prenom: "B", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" },
    ] as never[];
    expect(filterStudentFallback(students, { ...filters, search: "", archive: "all" }).map((student) => student.id)).toEqual(["s-1", "s-2", "s-3"]);
  });
});
