import { describe, expect, it } from "vitest";
import { mappedAssignmentScope, reenrollTerminalStudent } from "./archivedStudentsImport.js";

describe("import annuel des portées pédagogiques", () => {
  it("remappe les options canoniques et recalcule la clé de groupe", () => {
    const classIds = new Map([["old-class", "new-class"]]);
    expect(mappedAssignmentScope({
      courseScope: "common",
      targetOptionIds: ["old-class::scientifique", "old-class::commerciale"],
      studentGroupKey: "stale",
    }, classIds)).toEqual({
      courseScope: "common",
      targetOptionIds: ["new-class::commerciale", "new-class::scientifique"],
      studentGroupKey: "common--new-class%3A%3Acommerciale--new-class%3A%3Ascientifique",
    });
  });

  it("laisse les affectations historiques sans nouvelle portée", () => {
    expect(mappedAssignmentScope({}, new Map())).toEqual({});
  });
});

type Document = Record<string, unknown>;
type Reference = { path: string; id: string };
type Query = { collection: string; filters: Array<[string, unknown]>; where: (field: string, operator: string, value: unknown) => Query };

function terminalFixture(changes: { sourceYear?: Document; sourceStudent?: Document; targetClasses?: Document[]; targetStudents?: Document[] } = {}) {
  const records = new Map<string, Document>([
    ["users/admin", { role: "school_admin", schoolId: "school", status: "active", active: true }],
    ["schools/school", { status: "active", activeSchoolYearId: "year-current" }],
    ["schoolYears/year-old", { schoolId: "school", name: "2025-2026", status: "archived", ...changes.sourceYear }],
    ["schoolYears/year-current", { schoolId: "school", name: "2026-2027", status: "active" }],
    ["students/student-old", { schoolId: "school", schoolYearId: "year-old", className: "4ème Humanité", status: "ACTIVE", matricule: "MAT-1", nom: "K", postnom: "M", prenom: "A", birthDate: "2008-01-01", ...changes.sourceStudent }],
    ...(changes.targetClasses === undefined ? [{ id: "class-current", schoolId: "school", schoolYearId: "year-current", name: "4ème Humanité", active: true }] : changes.targetClasses).map((item) => [`classes/${item.id}`, item] as [string, Document]),
    ...(changes.targetStudents ?? []).map((item) => [`students/${item.id}`, item] as [string, Document]),
  ]);
  const db = {
    doc(path: string): Reference { return { path, id: path.split("/").at(-1) ?? "" }; },
    collection(collection: string): Query {
      const make = (filters: Array<[string, unknown]>): Query => ({ collection, filters, where: (field, _operator, value) => make([...filters, [field, value]]) });
      return make([]);
    },
    async runTransaction<T>(operation: (transaction: {
      get: (reference: Reference | Query) => Promise<unknown>;
      create: (reference: Reference, value: Document) => void;
      update: (reference: Reference, value: Document) => void;
    }) => Promise<T>): Promise<T> {
      const writes: Array<() => void> = [];
      const result = await operation({
        get: async (reference) => {
          if ("path" in reference) return { exists: records.has(reference.path), data: () => records.get(reference.path), ref: reference };
          return { docs: [...records].filter(([path, value]) => path.startsWith(`${reference.collection}/`) && reference.filters.every(([key, expected]) => value[key] === expected))
            .map(([path, value]) => ({ id: path.split("/").at(-1), data: () => value })) };
        },
        create: (reference, value) => { writes.push(() => { if (records.has(reference.path)) throw new Error("document déjà créé"); records.set(reference.path, value); }); },
        update: (reference, value) => { writes.push(() => { records.set(reference.path, { ...records.get(reference.path), ...value }); }); },
      });
      for (const write of writes) write();
      return result;
    },
  };
  const caller = { uid: "admin", role: "school_admin", schoolId: "school" };
  const request = (mode: "complete" | "reenroll", confirmation = mode === "complete" ? "CONFIRMER LA FIN DE SCOLARITE" : "REINSCRIRE CET ELEVE") => reenrollTerminalStudent({
    db: db as never, caller, body: { schoolId: "school", sourceStudentId: "student-old", mode, confirmation, examResultConfirmed: true },
  });
  return { records, caller, request, db };
}

describe("décisions manuelles de fin de cycle", () => {
  it("confirme la fin sans nouvelle inscription et refuse ensuite la réinscription", async () => {
    const { records, request } = terminalFixture();
    expect((await request("complete")).status).toBe("completed");
    expect(records.get("students/student-old")?.terminalDecision).toMatchObject({ type: "completed", decidedBy: "admin", sourceSchoolYearId: "year-old" });
    expect([...records.keys()].filter((key) => key.startsWith("students/"))).toEqual(["students/student-old"]);
    expect((await request("complete")).status).toBe("already-completed");
    await expect(request("reenroll")).rejects.toThrow("incompatible");
    expect([...records.keys()].filter((key) => key.startsWith("auditLogs/"))).toHaveLength(1);
  });

  it("réinscrit une seule fois dans la classe active et préserve le lien annuel", async () => {
    const { records, request } = terminalFixture();
    const result = await request("reenroll");
    expect(result.status).toBe("reenrolled");
    expect(records.get(`students/${result.targetStudentId}`)).toMatchObject({ schoolYearId: "year-current", className: "4ème Humanité", importedFromStudentId: "student-old", importedFromSchoolYearId: "year-old" });
    expect(records.get("students/student-old")?.terminalDecision).toMatchObject({ type: "reenrolled", targetStudentId: result.targetStudentId, decidedBy: "admin" });
    expect((await request("reenroll")).status).toBe("already-reenrolled");
    await expect(request("complete")).rejects.toThrow("incompatible");
    expect([...records.keys()].filter((key) => key.startsWith("students/"))).toHaveLength(2);
  });

  it("refuse une archive plus ancienne, non archivée ou d'une autre école", async () => {
    for (const sourceYear of [{ name: "2024-2025" }, { status: "draft" }, { schoolId: "other" }]) {
      const { records, request } = terminalFixture({ sourceYear });
      await expect(request("complete")).rejects.toThrow("immédiatement précédente");
      await expect(request("reenroll")).rejects.toThrow("immédiatement précédente");
      expect(records.get("students/student-old")?.terminalDecision).toBeUndefined();
    }
  });

  it("refuse une autre classe et une fiche de l'année active", async () => {
    const otherClass = terminalFixture({ sourceStudent: { className: "3ème Humanité" } });
    await expect(otherClass.request("complete")).rejects.toThrow("4ème Humanité");
    await expect(otherClass.request("reenroll")).rejects.toThrow("4ème Humanité");
    const activeSource = terminalFixture({ sourceStudent: { schoolYearId: "year-current" } });
    await expect(activeSource.request("complete")).rejects.toThrow("année archivée");
  });

  it("refuse une classe cible absente, un doublon et une décision non confirmée", async () => {
    const missing = terminalFixture({ targetClasses: [] });
    await expect(missing.request("reenroll")).rejects.toThrow("n’existe pas");
    const duplicate = terminalFixture({ targetStudents: [{ id: "already", schoolId: "school", schoolYearId: "year-current", matricule: "MAT-1" }] });
    await expect(duplicate.request("complete")).rejects.toThrow("déjà inscrit");
    expect((await duplicate.request("reenroll")).status).toBe("already-reenrolled");
    const { db, records, caller } = terminalFixture();
    await expect(reenrollTerminalStudent({ db: db as never, caller, body: { schoolId: "school", sourceStudentId: "student-old", mode: "complete", confirmation: "CONFIRMER LA FIN DE SCOLARITE", examResultConfirmed: false } })).rejects.toThrow("confirmée");
    expect(records.get("students/student-old")?.terminalDecision).toBeUndefined();
  });

  it("refuse les rôles et élèves hors établissement", async () => {
    const { db, records } = terminalFixture();
    const body = { schoolId: "school", sourceStudentId: "student-old", mode: "complete", confirmation: "CONFIRMER LA FIN DE SCOLARITE", examResultConfirmed: true };
    await expect(reenrollTerminalStudent({ db: db as never, caller: { uid: "other", role: "teacher", schoolId: "school" }, body })).rejects.toThrow("réservée");
    records.set("students/student-old", { ...records.get("students/student-old"), schoolId: "other" });
    await expect(reenrollTerminalStudent({ db: db as never, caller: { uid: "admin", role: "school_admin", schoolId: "school" }, body })).rejects.toThrow("inaccessible");
  });

  it("autorise aussi le Secrétaire actif de la même école", async () => {
    const { db, records } = terminalFixture();
    records.set("users/secretary", { role: "secretary", schoolId: "school", status: "active", active: true });
    const result = await reenrollTerminalStudent({ db: db as never, caller: { uid: "secretary", role: "secretary", schoolId: "school" }, body: { schoolId: "school", sourceStudentId: "student-old", mode: "complete", confirmation: "CONFIRMER LA FIN DE SCOLARITE", examResultConfirmed: true } });
    expect(result.status).toBe("completed");
    expect(records.get("students/student-old")?.terminalDecision).toMatchObject({ decidedBy: "secretary" });
  });
});
