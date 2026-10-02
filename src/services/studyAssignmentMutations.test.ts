import { describe, expect, it } from "vitest";
import { saveStudyAssignments, setStudyAssignmentActive } from "../../api/_lib/studyAssignmentGrants.js";

function database(initial: Record<string, Record<string, unknown>>) {
  const records = new Map(Object.entries(initial));
  const doc = (path: string) => ({ path, id: path.split("/").at(-1) });
  const collection = (collectionPath: string) => ({ where: (field: string, _operator: string, value: string) => ({ collectionPath, field, value }) });
  type Query = ReturnType<ReturnType<typeof collection>["where"]>;
  const db = {
    doc,
    collection,
    runTransaction: async (run: (transaction: {
      get: (reference: ReturnType<typeof doc> | Query) => Promise<unknown>;
      set: (reference: ReturnType<typeof doc>, data: Record<string, unknown>) => void;
      create: (reference: ReturnType<typeof doc>, data: Record<string, unknown>) => void;
      update: (reference: ReturnType<typeof doc>, data: Record<string, unknown>) => void;
      delete: (reference: ReturnType<typeof doc>) => void;
    }) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const result = await run({
        get: async (reference) => "path" in reference
          ? { ref: reference, id: reference.id, exists: records.has(reference.path), data: () => records.get(reference.path) }
          : { docs: [...records].filter(([path, value]) => path.startsWith(`${reference.collectionPath}/`) && value[reference.field] === reference.value).map(([path, value]) => ({ ref: doc(path), id: path.split("/").at(-1), exists: true, data: () => value })) },
        set: (reference, data) => writes.push(() => records.set(reference.path, data)),
        create: (reference, data) => writes.push(() => { if (records.has(reference.path)) throw Error("already exists"); records.set(reference.path, data); }),
        update: (reference, data) => writes.push(() => records.set(reference.path, { ...records.get(reference.path), ...data })),
        delete: (reference) => writes.push(() => records.delete(reference.path)),
      });
      writes.forEach((write) => write());
      return result;
    },
  };
  return { db, records };
}

const school = "school-a", year = "year-a", teacher = "teacher-a", uid = "user-a", subject = "subject-a", schoolClass = "class-a";
const actor = { uid: "director-a", role: "study_director", schoolId: school };
const input = { schoolId: school, schoolYearId: year, teacherId: teacher, subjectIds: [subject], classSelections: [{ classId: schoolClass }], weeklyPeriods: 2, active: true };
const fixtures = () => ({
  "users/director-a": { id: "director-a", schoolId: school, role: "study_director", status: "active", active: true },
  [`schools/${school}`]: { status: "active", activeSchoolYearId: year },
  [`schoolYears/${year}`]: { schoolId: school, status: "active" },
  [`teachers/${teacher}`]: { schoolId: school, schoolYearId: year, status: "active", userId: uid },
  [`users/${uid}`]: { id: uid, schoolId: school, role: "teacher", status: "active", active: true },
  [`subjects/${subject}`]: { schoolId: school, schoolYearId: year, active: true },
  [`classes/${schoolClass}`]: { schoolId: school, schoolYearId: year, name: "Classe A", active: true },
});

describe("affectation et grant Storage dans une transaction serveur", () => {
  it("crée l'affectation et la clé exacte ensemble, puis les révoque ensemble", async () => {
    const { db, records } = database(fixtures());
    await saveStudyAssignments({ db, caller: actor, body: input });
    const assignmentId = `${school}__${year}__${teacher}__${subject}__${schoolClass}`;
    expect(records.get(`pedagogicalAssignments/${assignmentId}`)?.active).toBe(true);
    expect(records.get(`users/${uid}`)?.storageAssignmentKeys).toEqual([`${school}/${year}/${teacher}/${assignmentId}`]);
    await setStudyAssignmentActive({ db, caller: actor, body: { schoolId: school, schoolYearId: year, assignmentId, active: false } });
    expect(records.get(`pedagogicalAssignments/${assignmentId}`)?.active).toBe(false);
    expect(records.get(`users/${uid}`)?.storageAssignmentKeys).toEqual([]);
  });
  it("refuse une école ou un utilisateur inactif avant toute écriture", async () => {
    const first = database(fixtures());
    await expect(saveStudyAssignments({ db: first.db, caller: { ...actor, schoolId: "other" }, body: input })).rejects.toThrow();
    expect(first.records.size).toBe(7);
    const second = database({ ...fixtures(), [`users/${uid}`]: { id: uid, schoolId: school, role: "teacher", status: "inactive", active: false } });
    await expect(saveStudyAssignments({ db: second.db, caller: actor, body: input })).rejects.toThrow();
    expect(second.records.size).toBe(7);
  });
  it("préserve l'opération pédagogique legacy sans userId et sans grant Storage", async () => {
    const { db, records } = database({ ...fixtures(), [`teachers/${teacher}`]: { schoolId: school, schoolYearId: year, status: "active" } });
    await saveStudyAssignments({ db, caller: actor, body: input });
    expect(records.get(`users/${uid}`)).not.toHaveProperty("storageAssignmentKeys");
    expect(records.get(`pedagogicalAssignments/${school}__${year}__${teacher}__${subject}__${schoolClass}`)?.active).toBe(true);
  });
  it("refuse un ancien token Directeur si le rôle du profil a changé", async () => {
    const { db, records } = database({ ...fixtures(), "users/director-a": { id: "director-a", schoolId: school, role: "cashier", status: "active", active: true } });
    await expect(saveStudyAssignments({ db, caller: actor, body: input })).rejects.toThrow();
    expect(records.size).toBe(7);
  });
  it("refuse une classe explicitement hors des sections du Directeur", async () => {
    const { db, records } = database({ ...fixtures(), "users/director-a": { id: "director-a", schoolId: school, role: "study_director", status: "active", active: true, sectionIds: ["Primaire"] }, [`classes/${schoolClass}`]: { schoolId: school, schoolYearId: year, name: "Classe A", section: "Secondaire", active: true } });
    await expect(saveStudyAssignments({ db, caller: actor, body: input })).rejects.toThrow();
    expect(records.size).toBe(7);
  });
  it("valide une option métier distincte de l'ID de classe et rattache le titulaire opérationnel", async () => {
    const optionKey = `${schoolClass}::litteraire`;
    const childId = "operational-literary-a";
    const { db, records } = database({ ...fixtures(), [`classes/${childId}`]: { id: childId, schoolId: school, schoolYearId: year, name: "Classe Littéraire A", parentClassId: schoolClass, classOptionKey: optionKey, subClassLabel: "A", active: true } });
    await expect(saveStudyAssignments({ db, caller: actor, body: input })).rejects.toThrow("type de cours");
    await saveStudyAssignments({ db, caller: actor, body: { ...input, classSelections: [{ classId: schoolClass, courseScope: "option", targetOptionIds: [optionKey] }], titularClassIds: [childId] } });
    const assignmentId = `${school}__${year}__${teacher}__${subject}__${schoolClass}__option--${encodeURIComponent(optionKey)}`;
    expect(records.get(`pedagogicalAssignments/${assignmentId}`)?.titularClassId).toBe(childId);
    expect(records.get(`classTitulars/${school}__${year}__${childId}`)?.assignmentId).toBe(assignmentId);
    expect(records.get(`users/${uid}`)?.storageAssignmentKeys).toEqual([`${school}/${year}/${teacher}/${assignmentId}`]);
  });
});
