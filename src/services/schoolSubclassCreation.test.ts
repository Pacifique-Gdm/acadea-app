import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The Vercel helper is intentionally implemented in JavaScript.
import { createSchoolSubclasses } from "../../api/_lib/schoolSubclassCreation.js";

function fixture(siblings: Array<{ id: string; schoolId?: string; schoolYearId?: string; parentClassId?: string; classOptionKey?: string; subClassLabel: string; active?: boolean }> = [], parentName = "7ème CTEB") {
  const parent = { schoolId: "school-a", schoolYearId: "year-a", name: parentName, active: true };
  const siblingDocs = siblings.map((item) => ({ id: item.id, ref: { path: `classes/${item.id}` }, data: () => ({ schoolId: "school-a", schoolYearId: "year-a", parentClassId: "parent", active: true, ...item }) }));
  const transaction = {
    get: vi.fn(async (ref: { path?: string; field?: string }) => {
      if (ref.path === "users/actor") return { exists: true, data: () => ({ role: "secretary", schoolId: "school-a", active: true }) };
      if (ref.path === "schools/school-a") return { exists: true, data: () => ({ schoolOptions: ["Littéraire", "Sciences"] }) };
      if (ref.path === "classes/parent") return { exists: true, data: () => parent };
      return { docs: siblingDocs };
    }),
    create: vi.fn(), update: vi.fn(),
  };
  const db = {
    doc: vi.fn((path: string) => ({ path, get: async () => path === "schoolYears/year-a" ? { exists: true, data: () => ({ schoolId: "school-a", status: "active" }) } : undefined })),
    collection: vi.fn(() => ({ where: (field: string) => ({ field }) })),
    runTransaction: vi.fn((callback: (value: unknown) => unknown) => callback(transaction)),
  };
  const input = { db, caller: { uid: "actor", role: "secretary", schoolId: "school-a" }, body: { schoolId: "school-a", schoolYearId: "year-a", parentId: "parent", parentName, labels: ["B"], confirmation: "AJOUTER CETTE SOUS-CLASSE" } };
  return { input, transaction, db };
}

describe("création serveur de sous-classes", () => {
  it("ajoute B après A sans dupliquer A", async () => {
    const { input, transaction } = fixture([{ id: "a", subClassLabel: "A" }]);
    await expect(createSchoolSubclasses(input)).resolves.toMatchObject({ parentId: "parent", subclassIds: [expect.any(String)] });
    expect(transaction.create).toHaveBeenCalledTimes(1);
    expect(transaction.create.mock.calls[0]?.[1]).toMatchObject({ subClassLabel: "B", parentClassId: "parent", schoolId: "school-a", schoolYearId: "year-a" });
  });
  it.each(["A", " a ", "À"])("refuse un vrai doublon normalisé %s", async (label) => {
    const { input, transaction } = fixture([{ id: "a", subClassLabel: "A" }]);
    await expect(createSchoolSubclasses({ ...input, body: { ...input.body, labels: [label] } })).rejects.toMatchObject({ code: "duplicate-subclass" });
    expect(transaction.create).not.toHaveBeenCalled();
  });
  it("ignore les homonymes d'une autre école, année ou classe", async () => {
    const { input, transaction } = fixture([
      { id: "foreign-school", subClassLabel: "B", schoolId: "school-b" },
      { id: "foreign-year", subClassLabel: "B", schoolYearId: "year-b" },
      { id: "foreign-parent", subClassLabel: "B", parentClassId: "other" },
    ]);
    await expect(createSchoolSubclasses(input)).resolves.toHaveProperty("subclassIds");
    expect(transaction.create).toHaveBeenCalledOnce();
  });
  it("isole les sous-classes Littéraire et Sciences du même parent Humanités", async () => {
    const { input, transaction } = fixture([{ id: "science-a", classOptionKey: "parent::sciences", subClassLabel: "A" }], "1ère Humanité");
    await expect(createSchoolSubclasses({ ...input, body: { ...input.body, labels: ["A"], classOptionKey: "parent::litteraire" } })).resolves.toHaveProperty("subclassIds");
    expect(transaction.create.mock.calls[0]?.[1]).toMatchObject({ classOptionKey: "parent::litteraire", subClassLabel: "A" });
  });
  it("accepte l'alias historique Scientifique d'une option Sciences de l'école", async () => {
    const { input, transaction } = fixture([], "1ère Humanité");
    await expect(createSchoolSubclasses({ ...input, body: { ...input.body, classOptionKey: "parent::scientifique" } })).resolves.toHaveProperty("subclassIds");
    expect(transaction.create.mock.calls[0]?.[1]).toMatchObject({ classOptionKey: "parent::scientifique" });
  });
  it("exige une option scolaire réelle pour Humanités", async () => {
    const { input, transaction } = fixture([], "1ère Humanité");
    await expect(createSchoolSubclasses(input)).rejects.toMatchObject({ code: "invalid-option" });
    await expect(createSchoolSubclasses({ ...input, body: { ...input.body, classOptionKey: "parent::inconnue" } })).rejects.toMatchObject({ code: "invalid-option" });
    expect(transaction.create).not.toHaveBeenCalled();
  });
  it("réactive l'identité historique d'une sous-classe supprimée sans doublon", async () => {
    const { input, transaction } = fixture([{ id: "old-b", subClassLabel: "B", active: false }]);
    await expect(createSchoolSubclasses(input)).resolves.toMatchObject({ subclassIds: ["old-b"] });
    expect(transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "classes/old-b" }), expect.objectContaining({ active: true }));
    expect(transaction.create).not.toHaveBeenCalled();
  });
  it("refuse les confirmations incorrectes avant toute transaction", async () => {
    const { input, db } = fixture();
    await expect(createSchoolSubclasses({ ...input, body: { ...input.body, confirmation: "AJOUTER CETTE SOUS-CLASSE " } })).rejects.toMatchObject({ code: "invalid-confirmation" });
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
  it("refuse un rôle ou une école non autorisés", async () => {
    const { input, db } = fixture();
    await expect(createSchoolSubclasses({ ...input, caller: { ...input.caller, schoolId: "school-b" } })).rejects.toMatchObject({ code: "permission-denied" });
    expect(db.runTransaction).not.toHaveBeenCalled();
  });
});
