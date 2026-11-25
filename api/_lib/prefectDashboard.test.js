import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPrefectDashboard } from "./prefectDashboard.js";

// Base en mémoire : doc().get() et collection().where(==|in)…get(), comme le service les utilise.
function memoryDb(values) {
  const snap = (path) => ({ exists: values.has(path), id: path.split("/").at(-1), data: () => values.get(path) });
  const query = (name, filters) => ({
    where: (key, op, value) => query(name, [...filters, [key, op, value]]),
    get: async () => ({ docs: [...values].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/").length === 2
      && filters.every(([key, op, value]) => op === "in" ? value.includes(data[key]) : data[key] === value)).map(([path]) => snap(path)) }),
  });
  return { doc: (path) => ({ get: async () => snap(path) }), collection: (name) => query(name, []) };
}
const school = "school-a", year = "year-1", today = "2026-11-26";
const base = { schoolId: school, schoolYearId: year };
function seeded() {
  const v = new Map();
  v.set(`schools/${school}`, { activeSchoolYearId: year, status: "active" });
  v.set(`schoolYears/${year}`, { schoolId: school, status: "active" });
  v.set("users/prefet", { role: "study_director", schoolId: school, studyFunction: "prefect_of_studies", sectionIds: ["Primaire"] });
  v.set("users/directeur", { role: "study_director", schoolId: school, sectionIds: ["Primaire"] });
  v.set("classes/c3p", { ...base, name: "3ème Primaire", section: "Primaire" });
  v.set("classes/c1s", { ...base, name: "1ère Secondaire", section: "Secondaire" });
  v.set("subjects/math", { ...base, name: "Mathématiques" });
  v.set("pedagogicalAssignments/a1", { ...base, active: true, classId: "c3p", subjectId: "math", teacherId: "t1" });
  v.set("pedagogicalAssignments/a2", { ...base, active: true, classId: "c1s", subjectId: "math", teacherId: "t2" });
  v.set("courseGradingConfigs/g1", { ...base, classId: "c3p", subjectId: "math", maxScore: 20 });
  v.set("courseGradingConfigs/g2", { ...base, classId: "c1s", subjectId: "math", maxScore: 20 });
  for (const [id, score] of [["e1", 8], ["e2", 15], ["e3", 9]]) {
    v.set(`students/${id}`, { ...base, nom: `NOM-${id}`, prenom: "Élève", classId: "c3p", className: "3ème Primaire", section: "Primaire", status: "ACTIVE" });
    v.set(`gradeEntries/${id}-p1`, { ...base, studentId: id, classId: "c3p", subjectId: "math", gradingSlot: "period_1", status: "graded", score });
  }
  v.set("students/s1", { ...base, nom: "SECONDAIRE", classId: "c1s", className: "1ère Secondaire", section: "Secondaire", status: "ACTIVE" });
  v.set("gradeEntries/s1-p1", { ...base, studentId: "s1", classId: "c1s", subjectId: "math", gradingSlot: "period_1", status: "graded", score: 1 });
  v.set("attendance/r1", { ...base, studentId: "e1", attendanceDate: today, status: "present" });
  v.set("attendance/r2", { ...base, studentId: "e2", attendanceDate: today, status: "late" });
  v.set("attendance/r3", { ...base, studentId: "e3", attendanceDate: today, status: "absent" });
  v.set("attendance/r4", { ...base, studentId: "s1", attendanceDate: today, status: "absent" });
  v.set("attendance/r5", { ...base, studentId: "e1", attendanceDate: "2026-11-25", status: "absent" });
  v.set("teachers/t1", { ...base, fullName: "MBUYI Jean", sectionIds: ["Primaire"] });
  v.set("teachers/t2", { ...base, fullName: "LUKUSA Marie", sectionIds: ["Secondaire"] });
  v.set("teacherAvailabilityRequests/q1", { ...base, teacherId: "t1", requestedDate: today, requestType: "FULL_DAY", status: "APPROVED", reason: "motif privé" });
  v.set("teacherAvailabilityRequests/q2", { ...base, teacherId: "t2", requestedDate: today, requestType: "FULL_DAY", status: "APPROVED" });
  v.set("teacherAvailabilityRequests/q3", { ...base, teacherId: "t1", requestedDate: today, requestType: "FULL_DAY", status: "PENDING" });
  return v;
}
const call = (uid, values = seeded(), extra = {}) => loadPrefectDashboard({ db: memoryDb(values), caller: { uid, role: "study_director", schoolId: school }, body: { schoolId: school, schoolYearId: year, today, ...extra } });

describe("lot P1 : tableau de pilotage du Préfet d'études (serveur)", () => {
  it("compte seulement les élèves, présences et absences approuvées de SES sections", async () => {
    const result = await call("prefet");
    expect(result.enrollment).toEqual({ students: 3, classes: 1 });
    expect(result.presence).toEqual({ recorded: 3, present: 2, absent: 1, rate: 67 });
    expect(result.approvedAbsences.count).toBe(1);
    expect(result.approvedAbsences.items).toEqual([{ teacherName: "MBUYI Jean", requestType: "FULL_DAY" }]);
  });

  it("élèves en difficulté : moyenne < 50 % sur la dernière période complète, hors autres sections", async () => {
    const result = await call("prefet");
    expect(result.difficulty).toMatchObject({ slot: "period_1", slotLabel: "1ère Période", threshold: 50, evaluated: 3, count: 2 });
  });

  it("ne renvoie aucun nom d'élève, aucun motif d'indisponibilité, aucune cote", async () => {
    const text = JSON.stringify(await call("prefet"));
    expect(text).not.toContain("NOM-");
    expect(text).not.toContain("SECONDAIRE");
    expect(text).not.toContain("motif privé");
    expect(text).not.toContain("LUKUSA");
  });

  it("refuse un Directeur des études (fonction absente) et un autre rôle", async () => {
    await expect(call("directeur")).rejects.toMatchObject({ status: 403 });
    await expect(loadPrefectDashboard({ db: memoryDb(seeded()), caller: { uid: "prefet", role: "teacher", schoolId: school }, body: { schoolId: school, schoolYearId: year, today } })).rejects.toMatchObject({ status: 403 });
  });

  it("refuse une autre école et une date invalide", async () => {
    await expect(loadPrefectDashboard({ db: memoryDb(seeded()), caller: { uid: "prefet", role: "study_director", schoolId: school }, body: { schoolId: "school-b", schoolYearId: year, today } })).rejects.toMatchObject({ status: 403 });
    await expect(call("prefet", seeded(), { today: "26/11/2026" })).rejects.toMatchObject({ status: 400 });
  });

  it("aucune période complète et aucun pointage : valeurs vides, sans erreur", async () => {
    const values = seeded();
    for (const key of [...values.keys()]) if (key.startsWith("gradeEntries/") || key.startsWith("attendance/")) values.delete(key);
    const result = await call("prefet", values);
    expect(result.presence).toEqual({ recorded: 0, present: 0, absent: 0, rate: null });
    expect(result.difficulty).toMatchObject({ slot: null, count: 0 });
  });

  it("le point d'entrée existant porte l'action, sans nouveau fichier api/", () => {
    const source = readFileSync(new URL("../manage-teacher-grading.js", import.meta.url), "utf8");
    expect(source).toContain('action === "prefect-dashboard"');
    expect(source).toContain("loadPrefectDashboard");
  });
});
