import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeTeacherGrading, GradingApiError, studentMatchesAssignment } from "./teacherGrading.js";

describe("API de cotation Enseignant", () => {
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
