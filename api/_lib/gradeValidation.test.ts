import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeGradePublication } from "./gradePublication.js";
import { prefectCoversClass, validationRequired } from "./gradeValidation.js";

type Row = { id: string; [key: string]: unknown };

// Même base en mémoire que gradePublication.test.ts, avec doc().set() pour la validation.
function fixture() {
  const records: Record<string, Row[]> = {
    schools: [{ id: "s", status: "active", activeSchoolYearId: "y", currency: "CDF", educationLevels: ["Primaire", "Secondaire"] }],
    schoolYears: [{ id: "y", schoolId: "s", name: "2027-2028", status: "active", currency: "CDF" }],
    users: [
      { id: "director", role: "study_director", schoolId: "s", active: true, sectionIds: ["Primaire"] },
      { id: "prefect", role: "study_director", studyFunction: "prefect_of_studies", name: "Jean Kasa", schoolId: "s", active: true, sectionIds: ["Primaire"] },
      { id: "prefect-sec", role: "study_director", studyFunction: "prefect_of_studies", name: "Marie Sec", schoolId: "s", active: true, sectionIds: ["Secondaire"] },
      { id: "parent-user", role: "parent", schoolId: "s", parentId: "parent", active: true },
    ],
    classes: [{ id: "class", schoolId: "s", schoolYearId: "y", name: "3ème Primaire", section: "Primaire", active: true }],
    students: [{ id: "student", schoolId: "s", schoolYearId: "y", classId: "class", className: "3ème Primaire", section: "Primaire", status: "ACTIVE", nom: "Test", postnom: "", prenom: "Aline" }],
    subjects: [{ id: "math", schoolId: "s", schoolYearId: "y", name: "Mathématiques" }],
    pedagogicalAssignments: [{ id: "assignment", schoolId: "s", schoolYearId: "y", classId: "class", subjectId: "math", teacherId: "teacher", active: true }],
    courseGradingConfigs: [{ id: "config", schoolId: "s", schoolYearId: "y", classId: "class", subjectId: "math", gradingSlot: "period_1", maxScore: 20 }],
    gradeEntries: [{ id: "grade", schoolId: "s", schoolYearId: "y", classId: "class", subjectId: "math", studentId: "student", gradingSlot: "period_1", status: "graded", score: 12, maxScoreSnapshot: 20 }],
    parents: [{ id: "parent", schoolId: "s", schoolYearId: "y", studentIds: ["student"], status: "active" }],
    feeTypes: [], payments: [], gradePublicationRuns: [], publishedGradeResults: [], notifications: [], gradeValidations: [],
  };
  const writes: string[] = [];
  const getRow = (path: string) => { const [collection, id] = path.split("/"); return records[collection]?.find((item) => item.id === id); };
  const snapshot = (row: Row | undefined) => ({ id: row?.id, exists: Boolean(row), data: () => row });
  const write = (path: string, row: Row, merge = false) => {
    const [collection, id] = path.split("/");
    records[collection] ??= [];
    const index = records[collection].findIndex((item) => item.id === id);
    if (index < 0) records[collection].push({ ...row, id });
    else records[collection][index] = merge ? { ...records[collection][index], ...row } : { ...row, id };
    writes.push(path);
  };
  const db = {
    doc: (path: string) => ({ path, get: async () => snapshot(getRow(path)), set: async (row: Row, options?: { merge?: boolean }) => write(path, row, options?.merge === true) }),
    collection: (collection: string) => {
      const query = (conditions: Array<[string, string, unknown]>): unknown => ({
        where: (field: string, op: string, value: unknown) => query([...conditions, [field, op, value]]),
        limit: () => query(conditions),
        get: async () => ({ docs: (records[collection] ?? []).filter((row) => conditions.every(([field, op, value]) =>
          op === "in" ? (value as unknown[]).includes(row[field]) : op === "array-contains" ? Array.isArray(row[field]) && row[field].includes(value) : row[field] === value)).map(snapshot) }),
      });
      return query([]);
    },
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const queued: Array<() => void> = [];
      const transaction = {
        get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
        create: (ref: { path: string }, row: Row) => queued.push(() => write(ref.path, row)),
        set: (ref: { path: string }, row: Row) => queued.push(() => write(ref.path, row)),
        update: (ref: { path: string }, row: Row) => queued.push(() => write(ref.path, row, true)),
      };
      const result = await callback(transaction);
      queued.forEach((operation) => operation());
      return result;
    },
  };
  return { db, records, writes };
}

const director = { uid: "director", role: "study_director", schoolId: "s" };
const prefect = { uid: "prefect", role: "study_director", schoolId: "s" };
const base = { schoolId: "s", schoolYearId: "y" };
const publish = { ...base, action: "grades-publish", classId: "class", slot: "period_1", requestId: "request_1234567890" };
const status = (db: unknown, caller = director) => executeGradePublication({ db, caller, body: { ...base, action: "grades-validation-status", classId: "class" } });
const validate = async (db: unknown, caller = prefect) => {
  const current = await status(db, caller);
  return executeGradePublication({ db, caller, body: { ...base, action: "grades-validation-validate", classId: "class", slot: "period_1", expectedFingerprint: current.validations.period_1.fingerprint } });
};

describe("lot P6 : validation exigée seulement si un Préfet existe pour la section", () => {
  it("calcul : Préfet de la section, Préfet d'une autre section, Préfet sans section, Préfet inactif", () => {
    const school = { educationLevels: ["Primaire", "Secondaire"] };
    const prefectP = { role: "study_director", studyFunction: "prefect_of_studies", schoolId: "s", sectionIds: ["Primaire"] };
    expect(validationRequired([prefectP], school, "s", "Primaire")).toBe(true);
    expect(validationRequired([prefectP], school, "s", "Secondaire")).toBe(false);
    expect(validationRequired([{ ...prefectP, sectionIds: [] }], school, "s", "Primaire")).toBe(false);
    expect(validationRequired([{ ...prefectP, active: false }], school, "s", "Primaire")).toBe(false);
    expect(validationRequired([{ ...prefectP, studyFunction: undefined }], school, "s", "Primaire")).toBe(false);
    expect(validationRequired([{ ...prefectP, schoolId: "autre" }], school, "s", "Primaire")).toBe(false);
  });

  it("classe sans section : seulement un Préfet dont les sections couvrent toute l'école", () => {
    const school = { educationLevels: ["Primaire", "Secondaire"] };
    expect(prefectCoversClass({ sectionIds: ["Primaire"] }, school, undefined)).toBe(false);
    expect(prefectCoversClass({ sectionIds: ["Primaire", "Secondaire"] }, school, undefined)).toBe(true);
  });

  it("sans Préfet pour la section : la Direction des études publie comme aujourd'hui", async () => {
    const { db, records } = fixture();
    records.users = records.users.filter((user) => user.id !== "prefect");
    expect(await status(db)).toEqual({ required: false });
    const options = await executeGradePublication({ db, caller: director, body: { ...base, action: "grades-options", classId: "class" } });
    expect(options).not.toHaveProperty("validations");
    await expect(executeGradePublication({ db, caller: director, body: publish })).resolves.toMatchObject({ ok: true, publishedCount: 1 });
  });

  it("avec un Préfet : publication refusée sans validation, puis acceptée après validation", async () => {
    const { db, records } = fixture();
    await expect(executeGradePublication({ db, caller: director, body: publish })).rejects.toMatchObject({ status: 409, code: "validation-required" });
    expect(records.publishedGradeResults).toHaveLength(0);
    await validate(db);
    const options = await executeGradePublication({ db, caller: director, body: { ...base, action: "grades-options", classId: "class" } });
    expect(options.validations.period_1).toMatchObject({ validated: true, stale: false, validatedByName: "Jean Kasa", validatedByFunction: "Préfet d'études" });
    expect(options.validations.period_2).toMatchObject({ validated: false });
    await expect(executeGradePublication({ db, caller: director, body: publish })).resolves.toMatchObject({ ok: true, publishedCount: 1 });
  });

  it("une cote modifiée après la validation demande une nouvelle validation", async () => {
    const { db, records } = fixture();
    await validate(db);
    records.gradeEntries[0].score = 15;
    await expect(executeGradePublication({ db, caller: director, body: publish })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("nouvelle validation") });
    expect((await status(db)).validations.period_1).toMatchObject({ validated: false, stale: true });
  });

  it("le Préfet valide ce qu'il a vu : empreinte différente → rechargez", async () => {
    const { db } = fixture();
    await expect(executeGradePublication({ db, caller: prefect, body: { ...base, action: "grades-validation-validate", classId: "class", slot: "period_1", expectedFingerprint: "ancienne" } })).rejects.toMatchObject({ status: 409 });
  });

  it("annulation de la validation : la publication redevient refusée", async () => {
    const { db } = fixture();
    await validate(db);
    await executeGradePublication({ db, caller: prefect, body: { ...base, action: "grades-validation-cancel", classId: "class", slot: "period_1" } });
    await expect(executeGradePublication({ db, caller: director, body: publish })).rejects.toMatchObject({ status: 409 });
  });

  it("seul le Préfet de la section valide : refus du Directeur des études et du Préfet d'une autre section", async () => {
    const { db, records } = fixture();
    await expect(validate(db, director)).rejects.toMatchObject({ status: 403 });
    records.users.find((user) => user.id === "prefect-sec")!.sectionIds = ["Secondaire"];
    await expect(validate(db, { uid: "prefect-sec", role: "study_director", schoolId: "s" })).rejects.toMatchObject({ status: 403 });
    expect(records.gradeValidations).toHaveLength(0);
  });

  it("refus en année archivée et pour une période sans résultat complet", async () => {
    const { db, records } = fixture();
    const current = await status(db, prefect);
    await expect(executeGradePublication({ db, caller: prefect, body: { ...base, action: "grades-validation-validate", classId: "class", slot: "period_2", expectedFingerprint: current.validations.period_2.fingerprint } })).rejects.toMatchObject({ status: 409 });
    records.schoolYears[0].status = "archived";
    await expect(validate(db)).rejects.toMatchObject({ status: 403 });
  });

  it("aucun nouveau fichier api/ et aucune règle de sécurité modifiée pour gradeValidations", () => {
    const source = readFileSync(new URL("./gradePublication.js", import.meta.url), "utf8");
    expect(source).toContain('action.startsWith("grades-validation-")');
    const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
    expect(rules).not.toContain("gradeValidations");
  });
});
