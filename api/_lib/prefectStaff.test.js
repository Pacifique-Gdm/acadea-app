import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listPrefectStaff } from "./prefectStaff.js";
import { loadPrefectDashboard } from "./prefectDashboard.js";

// Base en mémoire : doc().get() et collection().where(==|in)…get(), comme les services l'utilisent.
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
  v.set(`schools/${school}`, { status: "active" });
  v.set(`schoolYears/${year}`, { schoolId: school, status: "active" });
  v.set("users/prefet", { role: "study_director", schoolId: school, studyFunction: "prefect_of_studies", sectionIds: ["Primaire"] });
  v.set("users/directeur", { role: "study_director", schoolId: school, sectionIds: ["Primaire"] });
  v.set("classes/c3p", { ...base, name: "3ème Primaire", section: "Primaire" });
  v.set("classes/c1s", { ...base, name: "1ère Secondaire", section: "Secondaire" });
  v.set("subjects/math", { ...base, name: "Mathématiques" });
  v.set("subjects/fr", { ...base, name: "Français" });
  // t1 : section sur le COMPTE seulement (cas réel de l'application), sans affectation.
  v.set("teachers/t1", { ...base, fullName: "MBUYI Jean", userId: "u-t1", status: "active", phone: "0999" });
  v.set("users/u-t1", { role: "teacher", schoolId: school, sectionIds: ["Primaire"] });
  // t2 : Secondaire, mais une affectation dans une classe du Primaire.
  v.set("teachers/t2", { ...base, fullName: "LUKUSA Marie", userId: "u-t2", status: "active" });
  v.set("users/u-t2", { role: "teacher", schoolId: school, sectionIds: ["Secondaire"] });
  // t3 : Secondaire seulement → hors des sections du Préfet.
  v.set("teachers/t3", { ...base, fullName: "KALALA Paul", userId: "u-t3", status: "active" });
  v.set("users/u-t3", { role: "teacher", schoolId: school, sectionIds: ["Secondaire"] });
  v.set("pedagogicalAssignments/a1", { ...base, active: true, classId: "c3p", subjectId: "fr", teacherId: "t2", weeklyPeriods: 4 });
  v.set("pedagogicalAssignments/a2", { ...base, active: true, classId: "c1s", subjectId: "math", teacherId: "t2", weeklyPeriods: 6 });
  v.set("pedagogicalAssignments/a3", { ...base, active: true, classId: "c1s", subjectId: "math", teacherId: "t3", weeklyPeriods: 5 });
  v.set("teacherAvailabilityRequests/q1", { ...base, teacherId: "t1", requestedDate: today, requestType: "FULL_DAY", status: "APPROVED", reason: "motif privé" });
  v.set("teacherAvailabilityRequests/q2", { ...base, teacherId: "t1", requestedDate: "2026-11-28", requestType: "TIME_RANGE", startTime: "08:00", endTime: "10:00", status: "APPROVED" });
  v.set("teacherAvailabilityRequests/q3", { ...base, teacherId: "t1", requestedDate: "2026-11-20", requestType: "FULL_DAY", status: "APPROVED" });
  v.set("teacherAvailabilityRequests/q4", { ...base, teacherId: "t2", requestedDate: today, requestType: "FULL_DAY", status: "PENDING" });
  v.set("teacherAvailabilityRequests/q5", { ...base, teacherId: "t3", requestedDate: today, requestType: "FULL_DAY", status: "APPROVED" });
  return v;
}
const call = (uid, values = seeded(), extra = {}) => listPrefectStaff({ db: memoryDb(values), caller: { uid, role: "study_director", schoolId: school }, body: { schoolId: school, schoolYearId: year, today, ...extra } });

describe("lot P3 : enseignants des sections du Préfet d'études (serveur)", () => {
  it("retient les enseignants de SES sections (section lue sur le compte) et ceux qui y ont un cours", async () => {
    const result = await call("prefet");
    expect(result.teachers.map((item) => item.teacherName)).toEqual(["LUKUSA Marie", "MBUYI Jean"]);
  });

  it("cours et charge : seulement les classes de ses sections", async () => {
    const result = await call("prefet");
    const marie = result.teachers.find((item) => item.id === "t2");
    expect(marie.courses).toEqual([{ subjectName: "Français", className: "3ème Primaire", weeklyPeriods: 4 }]);
    expect(marie.weeklyPeriods).toBe(4);
    expect(marie.absentToday).toBe(false);
  });

  it("présence = absences approuvées d'aujourd'hui et à venir (ni en attente, ni passées)", async () => {
    const result = await call("prefet");
    const jean = result.teachers.find((item) => item.id === "t1");
    expect(jean.absentToday).toBe(true);
    expect(jean.upcomingAbsenceCount).toBe(2);
    expect(jean.upcomingAbsences).toEqual([
      { date: today, requestType: "FULL_DAY" },
      { date: "2026-11-28", requestType: "TIME_RANGE", startTime: "08:00", endTime: "10:00" },
    ]);
  });

  it("ne renvoie ni motif, ni téléphone, ni enseignant d'une autre section", async () => {
    const text = JSON.stringify(await call("prefet"));
    expect(text).not.toContain("motif privé");
    expect(text).not.toContain("0999");
    expect(text).not.toContain("KALALA");
  });

  it("refuse le Directeur des études, une autre école et une date invalide", async () => {
    await expect(call("directeur")).rejects.toMatchObject({ status: 403 });
    await expect(listPrefectStaff({ db: memoryDb(seeded()), caller: { uid: "prefet", role: "study_director", schoolId: school }, body: { schoolId: "school-b", schoolYearId: year, today } })).rejects.toMatchObject({ status: 403 });
    await expect(call("prefet", seeded(), { today: "26/11/2026" })).rejects.toMatchObject({ status: 400 });
  });

  it("Préfet sans section : liste vide (comme P1 et P2)", async () => {
    const values = seeded();
    values.set("users/prefet", { role: "study_director", schoolId: school, studyFunction: "prefect_of_studies" });
    expect((await call("prefet", values)).teachers).toEqual([]);
  });

  it("le point d'entrée existant porte l'action, sans nouveau fichier api/", () => {
    const source = readFileSync(new URL("../manage-teacher-grading.js", import.meta.url), "utf8");
    expect(source).toContain('action === "prefect-staff"');
    expect(source).toContain("listPrefectStaff");
  });
});

describe("lot P3 : correction de P1 (section de l'enseignant lue sur son compte)", () => {
  it("une absence approuvée d'un enseignant dont la section n'est que sur son compte `users` est comptée", async () => {
    const values = seeded();
    const result = await loadPrefectDashboard({ db: memoryDb(values), caller: { uid: "prefet", role: "study_director", schoolId: school }, body: { schoolId: school, schoolYearId: year, today } });
    expect(result.approvedAbsences.items).toEqual([{ teacherName: "MBUYI Jean", requestType: "FULL_DAY" }]);
  });

  it("le compte l'emporte sur la fiche : fiche Primaire mais compte Secondaire → non compté", async () => {
    const values = seeded();
    values.set("teachers/t3", { ...base, fullName: "KALALA Paul", userId: "u-t3", status: "active", sectionIds: ["Primaire"] });
    const result = await loadPrefectDashboard({ db: memoryDb(values), caller: { uid: "prefet", role: "study_director", schoolId: school }, body: { schoolId: school, schoolYearId: year, today } });
    expect(result.approvedAbsences.items.map((item) => item.teacherName)).toEqual(["MBUYI Jean"]);
  });
});
