import { describe, expect, it } from "vitest";
import { saveManualStudent } from "./manualStudentSave.js";
import { identityLockId, migrateStudentIdentityIndex } from "./studentIdentityIndex.js";
import { studentIdentityKey } from "../../src/utils/studentSearch.js";

type Row = Record<string, unknown>;
type Query = { collection: string; filters: Array<[string, unknown]>; fields?: string[]; where(field: string, op: string, value: unknown): Query; select(...fields: string[]): Query; get(): Promise<{ docs: Snapshot[]; size: number }> };
type Snapshot = { id: string; exists: boolean; data: () => Row | undefined };

/** Fausse base en mémoire : documents, requêtes à égalités, projections, lots et transactions. */
function memoryDb(seed: Record<string, Row>) {
  const rows = new Map(Object.entries(seed));
  const queries: Array<{ collection: string; filters: Array<[string, unknown]> }> = [];
  const snapshot = (path: string): Snapshot => ({ id: path.split("/").at(-1)!, exists: rows.has(path), data: () => rows.get(path) });
  const run = (query: Query) => {
    queries.push({ collection: query.collection, filters: [...query.filters] });
    const docs = [...rows.keys()].filter((path) => path.startsWith(`${query.collection}/`))
      .filter((path) => query.filters.every(([field, value]) => rows.get(path)?.[field] === value))
      .map((path) => {
        const data = rows.get(path)!;
        const projected = query.fields ? Object.fromEntries(query.fields.filter((field) => field in data).map((field) => [field, data[field]])) : data;
        return { id: path.split("/").at(-1)!, exists: true, data: () => projected };
      });
    return { docs, size: docs.length };
  };
  const makeQuery = (collection: string, filters: Array<[string, unknown]> = [], fields?: string[]): Query => ({
    collection, filters, fields,
    where: (field, _op, value) => makeQuery(collection, [...filters, [field, value]], fields),
    select: (...selected) => makeQuery(collection, filters, selected),
    get: async () => run(makeQuery(collection, filters, fields)),
  });
  const db = {
    rows, queries,
    doc: (path: string) => ({ path, get: async () => snapshot(path), set: async (value: Row) => { rows.set(path, value); } }),
    collection: (name: string) => makeQuery(name),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
    batch: () => {
      const writes: Array<() => void> = [];
      return {
        create: (ref: { path: string }, value: Row) => writes.push(() => { if (rows.has(ref.path)) throw new Error("already-exists"); rows.set(ref.path, value); }),
        update: (ref: { path: string }, value: Row) => writes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...value })),
        commit: async () => writes.forEach((write) => write()),
      };
    },
    runTransaction: async <T>(callback: (transaction: Record<string, (...args: never[]) => unknown>) => Promise<T>) => {
      const writes: Array<() => void> = [];
      const result = await callback({
        get: (async (target: { path?: string } & Partial<Query>) => (target.path ? snapshot(target.path) : run(target as Query))) as never,
        set: ((ref: { path: string }, value: Row) => writes.push(() => rows.set(ref.path, value))) as never,
        create: ((ref: { path: string }, value: Row) => writes.push(() => { if (rows.has(ref.path)) throw new Error("already-exists"); rows.set(ref.path, value); })) as never,
        delete: ((ref: { path: string }) => writes.push(() => rows.delete(ref.path))) as never,
      });
      writes.forEach((write) => write());
      return result;
    },
  };
  return db;
}

const caller = { uid: "admin-a", role: "school_admin", schoolId: "school-a" };
const base = (): Record<string, Row> => ({
  "users/admin-a": { role: "school_admin", schoolId: "school-a", active: true },
  "users/admin-b": { role: "school_admin", schoolId: "school-b", active: true },
  "schools/school-a": { status: "active", activeSchoolYearId: "year-a" },
  "schools/school-b": { status: "active", activeSchoolYearId: "year-b" },
  "schoolYears/year-a": { name: "2026-2027", schoolId: "school-a", status: "active" },
  "schoolYears/year-b": { name: "2026-2027", schoolId: "school-b", status: "active" },
  "classes/class-a": { name: "1ère Primaire", schoolId: "school-a", schoolYearId: "year-a", active: true },
  "classes/class-b": { name: "1ère Primaire", schoolId: "school-b", schoolYearId: "year-b", active: true },
  // Fiche ancienne : ni champ de tri ni verrou (créée avant les protections récentes).
  "students/legacy": { schoolId: "school-a", schoolYearId: "year-old", nom: "KABAMBA", postnom: "ILUNGA", prenom: "JEAN", className: "1ère Primaire", status: "ACTIVE", photoUrl: "data:image/jpeg;base64,AAAA" },
  // Élève importé dans l'année : compte dans la numérotation des matricules.
  "students/imported": { schoolId: "school-a", schoolYearId: "year-a", nom: "MUKENDI", postnom: "", prenom: "ANNE", sortName: "mukendi anne", matricule: "ACD-25-0007", className: "1ère Primaire", status: "ACTIVE" },
});
const pupil = (id: string, changes: Row = {}) => ({ id: `student-${id}`, schoolId: "school-a", schoolYearId: "year-a", classId: "class-a", className: "1ère Primaire", nom: "KABAMBA", postnom: "ILUNGA", prenom: "JEAN", sexe: "M", birthDate: "2015-01-01", status: "ACTIVE", ...changes });
const save = (db: ReturnType<typeof memoryDb>, student: Row, intent = "create") => saveManualStudent({ db, caller, body: { student, intent } });
const fullSchoolReads = (db: ReturnType<typeof memoryDb>) => db.queries.filter((query) => query.collection === "students" && query.filters.length === 1 && query.filters[0][0] === "schoolId");

describe("inscription : index des identités par école (lot 8)", () => {
  it("école NON migrée : garde exactement l'ancienne vérification complète", async () => {
    const db = memoryDb(base());
    await expect(save(db, pupil("dup-1"))).rejects.toMatchObject({ code: "duplicate-student" });
    expect(fullSchoolReads(db).length).toBeGreaterThan(0);
  });

  it("simulation : décrit la migration sans rien écrire", async () => {
    const db = memoryDb(base());
    const before = JSON.stringify([...db.rows]);
    const plan = await migrateStudentIdentityIndex({ db, schoolId: "school-a" });
    expect(plan).toMatchObject({ students: 2, identities: 2, locksToCreate: 2, sortNameToBackfill: 1, applied: false });
    expect(JSON.stringify([...db.rows])).toBe(before);
  });

  it("migration : crée les verrous, complète le champ de tri sans toucher aux photos, puis pose le marqueur ; relancée, elle ne crée rien", async () => {
    const db = memoryDb(base());
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true, now: "2026-11-14T10:00:00.000Z" });
    const key = studentIdentityKey(base()["students/legacy"]);
    expect(db.rows.get(`studentIdentityLocks/${identityLockId("school-a", key)}`)).toMatchObject({ schoolId: "school-a", studentId: "legacy" });
    expect(db.rows.get("students/legacy")).toMatchObject({ sortName: "kabamba ilunga jean", photoUrl: "data:image/jpeg;base64,AAAA" });
    expect(db.rows.get("studentIdentityIndexStates/school-a")).toMatchObject({ status: "complete", version: 1, locksCreated: 2 });
    expect(await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true })).toMatchObject({ locksToCreate: 0, sortNameToBackfill: 0 });
  });

  it("école migrée : refuse le doublon d'une fiche ancienne sans relire toute l'école", async () => {
    const db = memoryDb(base());
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true });
    db.queries.length = 0;
    for (const variant of [pupil("dup-2"), pupil("dup-3", { nom: " kabamba ", postnom: "Ilunga", prenom: "jean " })]) {
      await expect(save(db, variant)).rejects.toMatchObject({ code: "duplicate-student", statusCode: 409 });
    }
    expect(fullSchoolReads(db)).toEqual([]);
  });

  it("école migrée : accepte une autre identité et garde la numérotation (élèves importés compris)", async () => {
    const db = memoryDb(base());
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true });
    db.queries.length = 0;
    const created = await save(db, pupil("new-1", { prenom: "PAUL" }));
    expect(created.student.matricule).toBe("ACD-26-0002"); // 1 élève déjà dans l'année → 2
    expect(fullSchoolReads(db)).toEqual([]);
    expect(db.rows.get(`studentIdentityLocks/${identityLockId("school-a", studentIdentityKey(pupil("new-1", { prenom: "PAUL" })))}`)).toMatchObject({ studentId: "student-new-1" });
  });

  it("école migrée : un élève importé après la migration (sans verrou) est quand même détecté", async () => {
    const db = memoryDb(base());
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true });
    db.rows.set("students/late-import", { schoolId: "school-a", schoolYearId: "year-a", nom: "LUBOYA", postnom: "", prenom: "MARC", sortName: "luboya marc", className: "1ère Primaire", status: "ACTIVE" });
    await expect(save(db, pupil("dup-4", { nom: "Luboya", postnom: "", prenom: "Marc" }))).rejects.toMatchObject({ code: "duplicate-student" });
  });

  it("le marqueur d'une école ne change rien pour une autre école", async () => {
    const db = memoryDb({ ...base(), "students/b-legacy": { schoolId: "school-b", schoolYearId: "year-b", nom: "TSHALA", postnom: "", prenom: "EVE", status: "ACTIVE" } });
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true });
    db.queries.length = 0;
    await expect(saveManualStudent({ db, caller: { uid: "admin-b", role: "school_admin", schoolId: "school-b" }, body: { intent: "create", student: { ...pupil("b-dup"), schoolId: "school-b", schoolYearId: "year-b", classId: "class-b", nom: "TSHALA", postnom: "", prenom: "EVE" } } })).rejects.toMatchObject({ code: "duplicate-student" });
    expect(fullSchoolReads(db).length).toBeGreaterThan(0);
  });

  it("école migrée : un changement de nom libère l'ancien verrou seulement s'il n'a plus de titulaire", async () => {
    const db = memoryDb(base());
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true });
    const created = await save(db, pupil("rename-me", { prenom: "LUC" }));
    const oldLock = `studentIdentityLocks/${identityLockId("school-a", studentIdentityKey(created.student))}`;
    expect(db.rows.has(oldLock)).toBe(true);
    await save(db, { ...created.student, prenom: "LUCIEN" }, "update");
    expect(db.rows.has(oldLock)).toBe(false);
  });

  it("refuse un identifiant d'école invalide", async () => {
    await expect(migrateStudentIdentityIndex({ db: memoryDb(base()), schoolId: "../autre" })).rejects.toThrow("invalide");
  });
});
