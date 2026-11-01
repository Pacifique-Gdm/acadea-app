import { describe, expect, it } from "vitest";
import { saveManualStudent } from "./manualStudentSave.js";

const operationId = "7e791e6d-cf08-43b9-8dc4-3ca61f3e54ff";
const studentId = `student-${operationId}`;
const caller = { uid: "secretary-a", role: "secretary", schoolId: "school-a" };
const body = { offlineOperationId: operationId, student: { id: studentId, schoolId: "school-a", schoolYearId: "year-a",
  classId: "class-a", className: "1ère Primaire", nom: "Fictif", postnom: "Test", prenom: "Alice",
  sexe: "F", birthDate: "2015-04-05", status: "ACTIVE" } };

function fixture() {
  const rows = new Map<string, Record<string, unknown>>([
    ["users/secretary-a", { role: "secretary", schoolId: "school-a", active: true }],
    ["schools/school-a", { status: "active", activeSchoolYearId: "year-a" }],
    ["schoolYears/year-a", { name: "2027-2028", schoolId: "school-a", status: "active" }],
    ["classes/class-a", { name: "1ère Primaire", schoolId: "school-a", schoolYearId: "year-a", active: true }],
  ]);
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: rows.has(path), data: () => rows.get(path) });
  const db = {
    doc: (path: string) => ({ path }),
    collection: (collection: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = { where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
        kind: "query", collection, filters };
      return query;
    },
    runTransaction: async (callback: (transaction: {
      get: (ref: { path?: string; collection?: string; filters?: Array<[string, unknown]> }) => Promise<unknown>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      delete: (ref: { path: string }) => void;
    }) => Promise<unknown>) => {
      const writes: Array<{ path: string; data?: Record<string, unknown> }> = [];
      const result = await callback({
        get: async (ref) => ref.path ? snapshot(ref.path) : { docs: [...rows.keys()]
          .filter((path) => path.startsWith(`${ref.collection}/`))
          .filter((path) => ref.filters?.every(([field, value]) => rows.get(path)?.[field] === value))
          .map((path) => ({ ...snapshot(path), data: () => rows.get(path) })) },
        set: (ref, data) => writes.push({ path: ref.path, data }),
        create: (ref, data) => writes.push({ path: ref.path, data }),
        delete: (ref) => writes.push({ path: ref.path }),
      });
      for (const write of writes) { if (write.data) rows.set(write.path, write.data); else rows.delete(write.path); }
      return result;
    },
  };
  return { db, rows };
}

describe("inscription locale sans doublon", () => {
  it("retrouve une inscription en ligne après perte de réponse sans second matricule", async () => {
    const { db, rows } = fixture();
    const request = { intent: "create", clientRequestId: "c".repeat(32), student: { ...body.student, id: `student-${"d".repeat(32)}` } };
    const first = await saveManualStudent({ db, caller, body: request });
    const repeated = await saveManualStudent({ db, caller, body: request });
    expect(first.student).toMatchObject({ matricule: "ACD-27-0001" });
    expect(repeated).toMatchObject({ idempotent: true, student: first.student });
    expect([...rows.keys()].filter((key) => key.startsWith("students/"))).toHaveLength(1);
    await expect(saveManualStudent({ db, caller, body: { ...request, student: { ...request.student, nom: "Autre" } } }))
      .rejects.toMatchObject({ statusCode: 409, code: "offline-conflict" });
    expect(rows.get(`students/${request.student.id}`)?.nom).toBe("Fictif");
  });
  it("attribue un seul matricule et retourne la même fiche sur répétition", async () => {
    const { db, rows } = fixture();
    const first = await saveManualStudent({ db, caller, body });
    const repeated = await saveManualStudent({ db, caller, body });
    expect(first).toMatchObject({ idempotent: false, student: { id: studentId, matricule: "ACD-27-0001" } });
    expect(repeated).toMatchObject({ idempotent: true, student: { id: studentId, matricule: "ACD-27-0001" } });
    expect([...rows.keys()].filter((key) => key.startsWith("students/"))).toEqual([`students/${studentId}`]);
  });

  it("refuse un identifiant réutilisé avec un autre élève ou une classe renommée", async () => {
    const { db } = fixture();
    await saveManualStudent({ db, caller, body });
    await expect(saveManualStudent({ db, caller, body: { ...body, student: { ...body.student, nom: "Autre" } } }))
      .rejects.toMatchObject({ statusCode: 409, code: "offline-conflict" });
    const changed = fixture();
    changed.rows.get("classes/class-a")!.name = "Classe renommée";
    await expect(saveManualStudent({ db: changed.db, caller, body })).rejects.toMatchObject({ statusCode: 409, code: "offline-conflict" });
    expect([...changed.rows.keys()].filter((key) => key.startsWith("students/"))).toHaveLength(0);
  });

  it("préserve une sous-classe et son option sans inventer de document option séparé", async () => {
    const { db, rows } = fixture();
    rows.set("classes/option-a", { id: "option-a", schoolId: "school-a", schoolYearId: "year-a",
      name: "1ère Primaire option A", parentClassId: "class-a", classOptionKey: "class-a::option::A", active: true });
    const student = { ...body.student, subClassId: "option-a", classOptionKey: "class-a::option::A", option: "A" };
    const saved = await saveManualStudent({ db, caller, body: { ...body, student } });
    expect(saved.student).toMatchObject({ subClassId: "option-a", classOptionKey: "class-a::option::A", option: "A" });
    expect(rows.get(`students/${studentId}`)?.subClassId).toBe("option-a");
  });
});

describe("enregistrement d'un élève par un administrateur de section", () => {
  const sectionActor = { uid: "section-a", role: "primary_admin", schoolId: "school-a" };
  const request = { intent: "create", clientRequestId: "a".repeat(32), student: {
    ...body.student, id: `student-${"b".repeat(32)}`, section: "Primaire",
  } };

  function scopedFixture() {
    const state = fixture();
    state.rows.set("users/section-a", { role: "primary_admin", schoolId: "school-a", status: "active", active: true, sectionIds: ["Primaire"] });
    state.rows.set("classes/class-secondary", { name: "1ère Humanité", schoolId: "school-a", schoolYearId: "year-a", active: true, section: "Secondaire" });
    return state;
  }

  it("crée uniquement dans sa section et conserve l'idempotence", async () => {
    const { db, rows } = scopedFixture();
    const created = await saveManualStudent({ db, caller: sectionActor, body: request });
    expect(created.student).toMatchObject({ section: "Primaire", classId: "class-a", schoolId: "school-a" });
    await expect(saveManualStudent({ db, caller: sectionActor, body: request })).resolves.toMatchObject({ idempotent: true });
    expect([...rows.keys()].filter((path) => path.startsWith("students/"))).toHaveLength(1);
    rows.set(`students/${request.student.id}`, { ...created.student, section: "Secondaire", className: "1ère Humanité" });
    await expect(saveManualStudent({ db, caller: sectionActor, body: request }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
  });

  it("refuse une autre section, une classe falsifiée et un compte désactivé sans écriture", async () => {
    const { db, rows } = scopedFixture();
    for (const student of [
      { ...request.student, className: "1ère Humanité", classId: "class-secondary", section: "Secondaire" },
      { ...request.student, className: "1ère Primaire", classId: "class-secondary", section: "Primaire" },
      { ...request.student, className: "1ère Primaire", classId: "class-a", section: "Secondaire" },
    ]) {
      await expect(saveManualStudent({ db, caller: sectionActor, body: { ...request, student } }))
        .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    }
    rows.set("users/section-a", { role: "primary_admin", schoolId: "school-a", status: "inactive", active: false, sectionIds: ["Primaire"] });
    await expect(saveManualStudent({ db, caller: sectionActor, body: request }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    expect([...rows.keys()].filter((path) => path.startsWith("students/"))).toHaveLength(0);
  });

  it("ne modifie pas un élève historique d'une autre section", async () => {
    const { db, rows } = scopedFixture();
    rows.set(`students/${request.student.id}`, { ...request.student, section: "Secondaire", className: "1ère Humanité", classId: "class-secondary", status: "ACTIVE" });
    await expect(saveManualStudent({ db, caller: sectionActor, body: { ...request, intent: "update", clientRequestId: undefined } }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    expect(rows.get(`students/${request.student.id}`)?.section).toBe("Secondaire");
  });
});
