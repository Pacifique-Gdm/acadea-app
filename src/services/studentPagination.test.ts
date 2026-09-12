import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => name), documentId: vi.fn(() => "__name__"), getCountFromServer: vi.fn(), getDocs: vi.fn(),
  limit: vi.fn((value) => ({ kind: "limit", value })), onSnapshot: vi.fn(), orderBy: vi.fn((field) => ({ kind: "orderBy", field })),
  query: vi.fn((...parts) => ({ parts })), startAfter: vi.fn((cursor) => ({ kind: "cursor", cursor })),
  where: vi.fn((field, op, value) => ({ kind: "where", field, op, value })),
}));
vi.mock("@firebase/firestore", () => mocks);
vi.mock("../firebase", () => ({ db: {} }));

import { filterStudentFallback, studentFilterConstraints, studentQueryKey } from "./studentPagination";

const filters = { schoolId: "school-a", schoolYearId: "year-a", search: " Él ", archive: "active" as const, section: "Primaire" as const, className: "1ère Primaire", option: "", allowedSections: ["Primaire"] as const };

describe("pagination source des élèves", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("trouve hors première page par préfixe, avec accents normalisés", () => {
    const students = Array.from({ length: 80 }, (_, index) => ({ id: `s-${String(index).padStart(3, "0")}`, schoolId: "school-a", schoolYearId: "year-a", matricule: `ACD-${index}`, nom: index === 79 ? "Élise" : `Nom${index}`, postnom: "", prenom: "Test", className: "1ère Primaire", section: "Primaire", status: "ACTIVE" })) as never[];
    expect(filterStudentFallback(students, { ...filters, className: "", search: "eli" }).map((item) => item.id)).toEqual(["s-079"]);
  });
});
