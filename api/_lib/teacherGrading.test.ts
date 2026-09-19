import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeTeacherGrading, GradingApiError, studentMatchesAssignment } from "./teacherGrading.js";

describe("API de cotation Enseignant", () => {
  const rosterDb = () => {
    const records: Record<string, Array<{ id: string; [key: string]: unknown }>> = {
      users: [{ id: "u", role: "teacher", schoolId: "s", active: true }],
      schoolYears: [{ id: "y", schoolId: "s" }],
      teachers: [{ id: "t", schoolId: "s", schoolYearId: "y", userId: "u", status: "active" }],
      pedagogicalAssignments: [{ id: "a", schoolId: "s", schoolYearId: "y", teacherId: "t", active: true, classId: "c", subjectId: "m", courseScope: "option", targetOptionIds: ["c::sciences"] }],
      classTitulars: [],
      classes: [{ id: "c", schoolId: "s", schoolYearId: "y", name: "2ème Humanité" }],
      students: [
        { id: "allowed", schoolId: "s", schoolYearId: "y", classId: "c", classOptionKey: "c::sciences", status: "ACTIVE" },
        { id: "other-option", schoolId: "s", schoolYearId: "y", classId: "c", classOptionKey: "c::litteraire", status: "ACTIVE" },
        { id: "other-class", schoolId: "s", schoolYearId: "y", classId: "other", status: "ACTIVE" },
        { id: "other-year", schoolId: "s", schoolYearId: "other", classId: "c", classOptionKey: "c::sciences", status: "ACTIVE" },
        { id: "other-school", schoolId: "other", schoolYearId: "y", classId: "c", classOptionKey: "c::sciences", status: "ACTIVE" },
        { id: "inactive", schoolId: "s", schoolYearId: "y", classId: "c", classOptionKey: "c::sciences", status: "inactive" },
      ],
    };
    const reads: Array<{ collection: string; conditions: Array<[string, string, unknown]> }> = [];
    const snapshot = (item?: { id: string; [key: string]: unknown }) => ({ id: item?.id, exists: Boolean(item), data: () => item });
    const db = {
      doc: (path: string) => ({ get: async () => {
        const [collection, id] = path.split("/");
        return snapshot(records[collection]?.find((item) => item.id === id));
      } }),
      collection: (collection: string) => {
        const query = (conditions: Array<[string, string, unknown]>) => ({
          where: (field: string, op: string, value: unknown) => query([...conditions, [field, op, value]]),
          get: async () => {
            reads.push({ collection, conditions });
            const docs = (records[collection] ?? []).filter((item) => conditions.every(([field, op, value]) => op === "in" ? (value as unknown[]).includes(item[field]) : item[field] === value)).map(snapshot);
            return { docs, size: docs.length };
          },
        });
        return query([]);
      },
    };
    return { db, reads };
  };

  it("actualise seulement les élèves actifs de l'affectation, de l'option, de l'école et de l'année autorisées", async () => {
    const { db, reads } = rosterDb();
    const body = { action: "load-roster", schoolId: "s", schoolYearId: "y", assignmentId: "a", classId: "c", subjectId: "m" };
    const result = await executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, body });
    expect(result).toMatchObject({ assignmentId: "a", students: [{ id: "allowed" }] });
    expect(result.students).toHaveLength(1);
    const studentReads = reads.filter((read) => read.collection === "students");
    expect(studentReads).toHaveLength(3);
    for (const read of studentReads) {
      expect(read.conditions).toContainEqual(["schoolId", "==", "s"]);
      expect(read.conditions).toContainEqual(["schoolYearId", "==", "y"]);
      expect(read.conditions.some(([field, op, value]) => ["classId", "subClassId", "className"].includes(field) && op === "in" && (value as unknown[]).length === 1)).toBe(true);
    }
  });

  it("refuse l'actualisation d'une classe ou d'un cours non affecté avant toute lecture élève", async () => {
    const { db, reads } = rosterDb();
    for (const override of [{ classId: "other" }, { subjectId: "other" }, { assignmentId: "other" }]) {
      await expect(executeTeacherGrading({ db, caller: { uid: "u", role: "teacher", schoolId: "s" }, body: { action: "load-roster", schoolId: "s", schoolYearId: "y", assignmentId: "a", classId: "c", subjectId: "m", ...override } })).rejects.toMatchObject<Partial<GradingApiError>>({ code: "permission-denied", status: 403 });
    }
    expect(reads.some((read) => read.collection === "students")).toBe(false);
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
    expect(source).toContain('queryInChunks(db, "students", schoolId, schoolYearId, "classId", classIds)');
    expect(source).toContain('queryInChunks(db, "students", schoolId, schoolYearId, "subClassId", classIds)');
    expect(source).toContain('queryInChunks(db, "students", schoolId, schoolYearId, "className", classNames)');
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
});
