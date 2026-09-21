import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeTeacherGrading, GradingApiError, studentMatchesAssignment } from "./teacherGrading.js";

describe("API de cotation Enseignant", () => {
  const rosterDb = () => {
    const records: Record<string, Array<{ id: string; [key: string]: unknown }>> = {
      users: [
        { id: "u", role: "teacher", schoolId: "s", active: true },
        { id: "parent-user", role: "parent", schoolId: "s", parentId: "parent-1", active: true },
        { id: "foreign-parent", role: "parent", schoolId: "other", parentId: "parent-2", active: true },
      ],
      schoolYears: [{ id: "y", schoolId: "s" }],
      teachers: [{ id: "t", schoolId: "s", schoolYearId: "y", userId: "u", status: "active" }],
      pedagogicalAssignments: [{ id: "a", schoolId: "s", schoolYearId: "y", teacherId: "t", active: true, classId: "c::sciences", subjectId: "m" }],
      classTitulars: [],
      classes: [
        { id: "c", schoolId: "s", schoolYearId: "y", name: "2ème Humanité", section: "Secondaire" },
        { id: "c::sciences", schoolId: "s", schoolYearId: "y", name: "2ème Sciences", parentClassId: "c", classOptionKey: "c::sciences", option: "Sciences" },
      ],
      students: [
        { id: "allowed", schoolId: "s", schoolYearId: "y", classId: "c", classOptionKey: "c::sciences", status: "ACTIVE", parentId: "parent-1", nom: "Kabuya", postnom: "", prenom: "Aline" },
        { id: "other-option", schoolId: "s", schoolYearId: "y", classId: "c", classOptionKey: "c::litteraire", status: "ACTIVE" },
        { id: "other-class", schoolId: "s", schoolYearId: "y", classId: "other", status: "ACTIVE" },
        { id: "other-year", schoolId: "s", schoolYearId: "other", classId: "c", classOptionKey: "c::sciences", status: "ACTIVE" },
        { id: "other-school", schoolId: "other", schoolYearId: "y", classId: "c", classOptionKey: "c::sciences", status: "ACTIVE" },
        { id: "inactive", schoolId: "s", schoolYearId: "y", classId: "c", classOptionKey: "c::sciences", status: "inactive" },
      ],
      parents: [
        { id: "parent-1", schoolId: "s", studentIds: ["allowed"] },
        { id: "parent-2", schoolId: "other", studentIds: ["allowed"] },
      ],
      teacherStudentObservations: [],
      notifications: [],
    };
    const reads: Array<{ collection: string; conditions: Array<[string, string, unknown]> }> = [];
    const writes: Array<{ path: string; value: Record<string, unknown> }> = [];
    const snapshot = (item?: { id: string; [key: string]: unknown }) => ({ id: item?.id, exists: Boolean(item), data: () => item });
    const db = {
      doc: (path: string) => ({
        get: async () => {
          const [collection, id] = path.split("/");
          return snapshot(records[collection]?.find((item) => item.id === id));
        },
        set: async (value: Record<string, unknown>) => { writes.push({ path, value }); },
      }),
      batch: () => ({
        set: (reference: { get: () => Promise<unknown>; set: (value: Record<string, unknown>) => Promise<void> }, value: Record<string, unknown>) => {
          const path = String(value.id).includes("__parent-user") ? `notifications/${value.id}` : "unknown";
          writes.push({ path, value });
        },
        commit: async () => undefined,
      }),
      collection: (collection: string) => {
        const query = (conditions: Array<[string, string, unknown]>) => ({
          where: (field: string, op: string, value: unknown) => query([...conditions, [field, op, value]]),
          get: async () => {
            reads.push({ collection, conditions });
            const docs = (records[collection] ?? []).filter((item) => conditions.every(([field, op, value]) => op === "in" ? (value as unknown[]).includes(item[field]) : op === "array-contains" ? Array.isArray(item[field]) && item[field].includes(value) : item[field] === value)).map(snapshot);
            return { docs, size: docs.length };
          },
        });
        return query([]);
      },
    };
    return { db, reads, writes };
  };

  it("actualise seulement les élèves actifs de l'affectation, de l'option, de l'école et de l'année autorisées", async () => {
    const { db, reads } = rosterDb();
    const body = { action: "load-roster", schoolId: "s", schoolYearId: "y", assignmentId: "a", classId: "c::sciences", subjectId: "m" };
    const result = await executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, body });
    expect(result).toMatchObject({ assignmentId: "a", students: [{ id: "allowed" }] });
    expect(result.students).toHaveLength(1);
    const studentReads = reads.filter((read) => read.collection === "students");
    expect(studentReads).toHaveLength(4);
    for (const read of studentReads) {
      expect(read.conditions).toContainEqual(["schoolId", "==", "s"]);
      expect(read.conditions).toContainEqual(["schoolYearId", "==", "y"]);
      expect(read.conditions.some(([field, op, value]) => ["classId", "subClassId", "className", "classOptionKey"].includes(field) && op === "in" && (value as unknown[]).length > 0)).toBe(true);
    }
  });

  it("charge le parent et l’option opérationnelle sans dupliquer le roster demandé séparément", async () => {
    const { db } = rosterDb();
    const result = await executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, body: { action: "load", schoolId: "s", schoolYearId: "y" } });
    expect(result.assignments.map((item: { id: string }) => item.id)).toEqual(["a"]);
    expect(result.classes.map((item: { id: string }) => item.id)).toEqual(["c", "c::sciences"]);
    expect(result.students).toEqual([]);
  });

  it("refuse l'actualisation d'une classe ou d'un cours non affecté avant toute lecture élève", async () => {
    const { db, reads } = rosterDb();
    for (const override of [{ classId: "other" }, { subjectId: "other" }, { assignmentId: "other" }]) {
      await expect(executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, body: { action: "load-roster", schoolId: "s", schoolYearId: "y", assignmentId: "a", classId: "c::sciences", subjectId: "m", ...override } })).rejects.toMatchObject<Partial<GradingApiError>>({ code: "permission-denied", status: 403 });
    }
    expect(reads.some((read) => read.collection === "students")).toBe(false);
  });

  it("enregistre l’observation puis notifie uniquement le parent réellement lié", async () => {
    const { db, writes } = rosterDb();
    const result = await executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, body: { action: "save-observation", schoolId: "s", schoolYearId: "y", assignmentId: "a", classId: "c::sciences", subjectId: "m", studentId: "allowed", observation: "Participation régulière." } });
    expect(result).toMatchObject({ ok: true, notificationCount: 1, notificationWarning: "" });
    expect(writes).toContainEqual(expect.objectContaining({ path: expect.stringContaining("teacherStudentObservations/"), value: expect.objectContaining({ studentId: "allowed", teacherId: "t", observation: "Participation régulière." }) }));
    expect(writes).toContainEqual(expect.objectContaining({ path: expect.stringContaining("notifications/"), value: expect.objectContaining({ recipientUserId: "parent-user", parentId: "parent-1", studentId: "allowed", title: "Nouvelle observation pédagogique", read: false }) }));
    expect(writes.some(({ value }) => value.recipientUserId === "foreign-parent")).toBe(false);
  });

  it("ne crée aucune observation ni notification pour un élève hors affectation", async () => {
    const { db, writes } = rosterDb();
    await expect(executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, body: { action: "save-observation", schoolId: "s", schoolYearId: "y", assignmentId: "a", classId: "c::sciences", subjectId: "m", studentId: "other-option", observation: "Refusée" } })).rejects.toMatchObject<Partial<GradingApiError>>({ code: "permission-denied", status: 403 });
    expect(writes).toHaveLength(0);
  });
  it("refuse un rôle autre qu'Enseignant avant toute lecture", async () => {
    const db = new Proxy({}, { get: () => { throw new Error("La base ne devait pas être appelée"); } });
    await expect(executeTeacherGrading({ db, caller: { uid: "u", role: "secretary", schoolId: "s" }, body: { action: "load", schoolId: "s", schoolYearId: "y" } })).rejects.toMatchObject<Partial<GradingApiError>>({ code: "permission-denied", status: 403 });
  });

  it("refuse un enseignant d'une autre école avant toute lecture", async () => {
    const db = new Proxy({}, { get: () => { throw new Error("La base ne devait pas être appelée"); } });
    await expect(executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "other" }, body: { action: "load", schoolId: "s", schoolYearId: "y" } })).rejects.toMatchObject<Partial<GradingApiError>>({ code: "permission-denied", status: 403 });
  });

  it("conserve l'auteur initial et cible les lectures par cours ou classe titulaire", () => {
    const source = readFileSync(new URL("./teacherGrading.js", import.meta.url), "utf8");
    expect(source).toContain("previous.data().teacherId : teacher.id");
    expect(source).toContain('.where("classId", "==", classId).where("subjectId", "==", subjectId)');
    expect(source).not.toContain('collection("gradeEntries").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get()');
  });

  it("regroupe les lectures élèves par classe et nom sans élargir leur périmètre", () => {
    const source = readFileSync(new URL("./teacherGrading.js", import.meta.url), "utf8");
    expect(source).toContain('queryInChunks(db, "students", schoolId, schoolYearId, "classId", candidateClassIds)');
    expect(source).toContain('queryInChunks(db, "students", schoolId, schoolYearId, "subClassId", classIds)');
    expect(source).toContain('queryInChunks(db, "students", schoolId, schoolYearId, "className", classNames)');
    expect(source).toContain('queryInChunks(db, "students", schoolId, schoolYearId, "classOptionKey", optionIds)');
    expect(source).toContain('.where(field, "in", chunk)');
    expect(source).not.toContain("classIds.flatMap");
  });

  it("filtre les élèves legacy selon les options explicites de l'affectation", () => {
    const assignment = { classId: "s__y__3eme-humanite", courseScope: "common", targetOptionIds: ["s__y__3eme-humanite::scientifique", "s__y__3eme-humanite::commerciale"] };
    const schoolClass = { id: assignment.classId, name: "3ème Humanité" };
    expect(studentMatchesAssignment({ className: "3ème Humanité", option: "Scientifique" }, assignment, schoolClass)).toBe(true);
    expect(studentMatchesAssignment({ className: "3ème Humanité", option: "Littéraire" }, assignment, schoolClass)).toBe(false);
    expect(studentMatchesAssignment({ className: "2ème Humanité", option: "Scientifique" }, assignment, schoolClass)).toBe(false);
  });

  it("charge le roster Production legacy sans métadonnées modernes sur la classe opérationnelle", async () => {
    const parentId = "s__y__3eme-humanite";
    const literaryId = `${parentId}::litteraire`;
    const reads: Array<{ collection: string; conditions: Array<[string, string, unknown]> }> = [];
    const source = {
      users: [{ id: "u", role: "teacher", schoolId: "s", active: true }],
      schoolYears: [{ id: "y", schoolId: "s" }],
      teachers: [{ id: "t", schoolId: "s", schoolYearId: "y", userId: "u", status: "active" }],
      pedagogicalAssignments: [{ id: "legacy-a", schoolId: "s", schoolYearId: "y", teacherId: "t", active: true, classId: literaryId, subjectId: "english" }],
      classTitulars: [],
      classes: [
        { id: parentId, schoolId: "s", schoolYearId: "y", name: "3ème" },
        { id: literaryId, schoolId: "s", schoolYearId: "y", name: "3ème Littéraire" },
      ],
      students: [
        { id: "keyed", schoolId: "s", schoolYearId: "y", className: "3ème Humanité", classOptionKey: literaryId, option: "Littéraire", status: "ACTIVE" },
        { id: "unkeyed", schoolId: "s", schoolYearId: "y", className: "3ème Humanité", option: "Littéraire", status: "ACTIVE" },
        { id: "wrong-option", schoolId: "s", schoolYearId: "y", className: "3ème Humanité", classOptionKey: `${parentId}::sciences`, option: "Sciences", status: "ACTIVE" },
      ],
      subjects: [{ id: "english", schoolId: "s", schoolYearId: "y" }],
      courseGradingConfigs: [],
      gradeEntries: [],
    };
    const snapshot = (item?: { id: string; [key: string]: unknown }) => ({ id: item?.id, exists: Boolean(item), data: () => item });
    const legacyDb = {
      doc: (path: string) => ({ get: async () => { const [collection, id] = path.split("/"); return snapshot(source[collection as keyof typeof source]?.find((item) => item.id === id)); } }),
      collection: (collection: keyof typeof source) => {
        const query = (conditions: Array<[string, string, unknown]>): unknown => ({
          where: (field: string, op: string, value: unknown) => query([...conditions, [field, op, value]]),
          get: async () => {
            reads.push({ collection, conditions });
            const docs = source[collection].filter((item) => conditions.every(([field, op, value]) => op === "in" ? (value as unknown[]).includes(item[field as keyof typeof item]) : item[field as keyof typeof item] === value)).map(snapshot);
            return { docs, size: docs.length };
          },
        });
        return query([]);
      },
    };
    const result = await executeTeacherGrading({ db: legacyDb, caller: { uid: "u", role: "teacher", schoolId: "s" }, body: { action: "load-roster", schoolId: "s", schoolYearId: "y", assignmentId: "legacy-a", classId: literaryId, subjectId: "english" } });
    expect(result.students.map((item: { id: string }) => item.id).sort()).toEqual(["keyed", "unkeyed"]);
  });

  it("conserve le roster d'une sous-classe moderne dont l'id contient le séparateur legacy", () => {
    const parentId = "s__y__4eme-primaire";
    const subclass = { id: `${parentId}::a`, name: "4ème Primaire A", parentClassId: parentId, subClassLabel: "A" };
    const parent = { id: parentId, name: "4ème Primaire" };
    const assignment = { classId: subclass.id, schoolId: "s", schoolYearId: "y" };
    const student = { schoolId: "s", schoolYearId: "y", classId: parentId, subClassId: subclass.id, className: "4ème Primaire", status: "ACTIVE" };

    expect(studentMatchesAssignment(student, assignment, subclass, parent)).toBe(true);
  });
});
