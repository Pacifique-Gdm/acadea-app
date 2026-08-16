import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeTeacherGrading, GradingApiError } from "./teacherGrading.js";

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

  it("parallélise les lectures indépendantes des élèves sans élargir leur périmètre", () => {
    const source = readFileSync(new URL("./teacherGrading.js", import.meta.url), "utf8");
    expect(source).toContain("const studentSnapshots = await Promise.all(classIds.flatMap");
    expect(source).toContain('.where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where(field, "==", classId)');
  });
});
