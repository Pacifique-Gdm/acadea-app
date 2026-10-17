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
  it("accepte une option historique existante et configurée sans inventer de liaison ni élargir les permissions", async () => {
    const firstOption = `${schoolClass}::litteraire`;
    const otherClass = "class-b";
    const otherOption = `${otherClass}::litteraire`;
    const schoolWithOptions = { ...fixtures()[`schools/${school}`], schoolOptions: ["Littéraire"] };
    const { db, records } = database({
      ...fixtures(),
      [`schools/${school}`]: schoolWithOptions,
      [`classes/${firstOption}`]: { schoolId: school, schoolYearId: year, name: "Classe A Littéraire", active: true },
      [`classes/${otherClass}`]: { id: otherClass, schoolId: school, schoolYearId: year, name: "Classe B", active: true },
      [`classes/${otherOption}`]: { schoolId: school, schoolYearId: year, name: "Classe B Littéraire", active: true },
    });
    const selected = (classId: string, targetOptionIds: string[]) => ({ ...input, classSelections: [{ classId, courseScope: "option", targetOptionIds }] });
    await expect(saveStudyAssignments({ db, caller: actor, body: selected(schoolClass, [otherOption]) })).rejects.toThrow("Option hors périmètre");
    await saveStudyAssignments({ db, caller: actor, body: selected(schoolClass, [firstOption]) });
    expect(records.get(`classes/${firstOption}`)).not.toHaveProperty("parentClassId");
    expect(records.get(`pedagogicalAssignments/${school}__${year}__${teacher}__${subject}__${schoolClass}__option--${encodeURIComponent(firstOption)}`)?.targetOptionIds).toEqual([firstOption]);
  });
  it("refuse une option legacy non configurée, inactive ou d'une autre année", async () => {
    const optionId = `${schoolClass}::litteraire`;
    const selected = { ...input, classSelections: [{ classId: schoolClass, courseScope: "option", targetOptionIds: [optionId] }] };
    for (const schoolOptions of [[], ["Sciences"]]) {
      const { db, records } = database({ ...fixtures(), [`schools/${school}`]: { ...fixtures()[`schools/${school}`], schoolOptions }, [`classes/${optionId}`]: { id: optionId, schoolId: school, schoolYearId: year, name: "Classe A Littéraire", active: true } });
      await expect(saveStudyAssignments({ db, caller: actor, body: selected })).rejects.toThrow("aucune option configurable");
      expect([...records.keys()].filter((path) => path.startsWith("pedagogicalAssignments/"))).toEqual([]);
    }
    for (const override of [{ active: false }, { schoolYearId: "other" }, { schoolId: "other" }, { subClassLabel: "A" }]) {
      const { db } = database({ ...fixtures(), [`schools/${school}`]: { ...fixtures()[`schools/${school}`], schoolOptions: ["Littéraire"] }, [`classes/${optionId}`]: { id: optionId, schoolId: school, schoolYearId: year, name: "Classe A Littéraire", active: true, ...override } });
      await expect(saveStudyAssignments({ db, caller: actor, body: selected })).rejects.toThrow("aucune option configurable");
    }
  });
  it("refuse une classe opérationnelle sans clé d'option et une option d'une autre classe", async () => {
    const operationalId = "operational-a";
    const ambiguousLegacyId = `${schoolClass}::a`;
    const otherBase = "class-b";
    const otherOption = `${otherBase}::commerciale`;
    const { db, records } = database({
      ...fixtures(),
      [`classes/${operationalId}`]: { id: operationalId, schoolId: school, schoolYearId: year, name: "Classe A", parentClassId: schoolClass, option: "Classe A", active: true },
      [`classes/${ambiguousLegacyId}`]: { id: ambiguousLegacyId, schoolId: school, schoolYearId: year, name: "Classe A", parentClassId: schoolClass, active: true },
      [`classes/${otherBase}`]: { id: otherBase, schoolId: school, schoolYearId: year, name: "Classe B", active: true },
      [`classes/${otherOption}`]: { id: otherOption, schoolId: school, schoolYearId: year, name: "Commerciale", parentClassId: otherBase, classOptionKey: otherOption, active: true },
    });
    const scoped = (targetOptionIds: string[]) => ({ ...input, classSelections: [{ classId: schoolClass, courseScope: "option", targetOptionIds }] });
    await expect(saveStudyAssignments({ db, caller: actor, body: scoped([operationalId]) })).rejects.toThrow("aucune option configurable");
    await expect(saveStudyAssignments({ db, caller: actor, body: scoped([ambiguousLegacyId]) })).rejects.toThrow("aucune option configurable");
    await expect(saveStudyAssignments({ db, caller: actor, body: scoped([otherOption]) })).rejects.toThrow("aucune option configurable");
    expect([...records.keys()].filter((path) => path.startsWith("pedagogicalAssignments/"))).toEqual([]);
  });
  it("enregistre puis modifie l'affectation avec l'option de la nouvelle classe sans altérer l'historique", async () => {
    const firstOption = `${schoolClass}::sciences`;
    const secondClass = "class-b";
    const secondOption = `${secondClass}::commerciale`;
    const { db, records } = database({
      ...fixtures(),
      [`classes/${firstOption}`]: { id: firstOption, schoolId: school, schoolYearId: year, name: "Sciences", parentClassId: schoolClass, classOptionKey: firstOption, active: true },
      [`classes/${secondClass}`]: { id: secondClass, schoolId: school, schoolYearId: year, name: "Classe B", active: true },
      [`classes/${secondOption}`]: { id: secondOption, schoolId: school, schoolYearId: year, name: "Commerciale", parentClassId: secondClass, classOptionKey: secondOption, active: true },
    });
    const body = { ...input, classSelections: [{ classId: schoolClass, courseScope: "option", targetOptionIds: [firstOption] }] };
    await saveStudyAssignments({ db, caller: actor, body });
    const historicalId = `${school}__${year}__${teacher}__${subject}__${schoolClass}__option--${encodeURIComponent(firstOption)}`;
    expect(records.get(`pedagogicalAssignments/${historicalId}`)?.targetOptionIds).toEqual([firstOption]);
    await expect(saveStudyAssignments({ db, caller: actor, body: { ...body, currentId: historicalId, classSelections: [{ classId: secondClass, courseScope: "option", targetOptionIds: [firstOption] }] } })).rejects.toThrow("Option hors périmètre");
    await saveStudyAssignments({ db, caller: actor, body: { ...body, currentId: historicalId, classSelections: [{ classId: secondClass, courseScope: "option", targetOptionIds: [secondOption] }] } });
    const newId = `${school}__${year}__${teacher}__${subject}__${secondClass}__option--${encodeURIComponent(secondOption)}`;
    expect(records.get(`pedagogicalAssignments/${historicalId}`)?.active).toBe(false);
    expect(records.get(`pedagogicalAssignments/${historicalId}`)?.targetOptionIds).toEqual([firstOption]);
    expect(records.get(`pedagogicalAssignments/${newId}`)?.targetOptionIds).toEqual([secondOption]);
    expect(records.get(`users/${uid}`)?.storageAssignmentKeys).toEqual([`${school}/${year}/${teacher}/${newId}`]);
  });
});
