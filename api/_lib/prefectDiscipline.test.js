import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listPrefectDiscipline } from "./prefectDiscipline.js";

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
const school = "school-a", year = "year-1";
const base = { schoolId: school, schoolYearId: year };
function seeded() {
  const v = new Map();
  v.set(`schools/${school}`, { activeSchoolYearId: year, status: "active" });
  v.set(`schoolYears/${year}`, { schoolId: school, status: "active" });
  v.set("users/prefet", { role: "study_director", schoolId: school, studyFunction: "prefect_of_studies", sectionIds: ["Primaire"] });
  v.set("users/directeur", { role: "study_director", schoolId: school, sectionIds: ["Primaire"] });
  v.set("students/p1", { ...base, nom: "KABEYA", prenom: "Grâce", className: "3ème Primaire", section: "Primaire" });
  v.set("students/p2", { ...base, nom: "ILUNGA", prenom: "Sarah", className: "1ère Primaire", section: "Primaire" });
  v.set("students/s1", { ...base, nom: "MUKENDI", prenom: "Paul", className: "2ème Secondaire", section: "Secondaire" });
  v.set("disciplineSanctions/d1", { ...base, studentId: "p1", studentName: "KABEYA Grâce", className: "3ème Primaire", reason: "Retards répétés", description: "détail interne", observation: "note privée", sanctionType: "Avertissement", duration: 0, startDate: "2026-11-24", expectedEndDate: "2026-11-24", status: "active", recurrenceNumber: 2, createdBy: "disc-1", createdByName: "Directeur Discipline" });
  v.set("disciplineSanctions/d2", { ...base, studentId: "p2", studentName: "ILUNGA Sarah", className: "1ère Primaire", reason: "Tenue non conforme", sanctionType: "Rappel", duration: 1, startDate: "2026-11-18", expectedEndDate: "2026-11-19", actualEndDate: "2026-11-19", status: "completed", recurrenceNumber: 1 });
  v.set("disciplineSanctions/d3", { ...base, studentId: "s1", studentName: "MUKENDI Paul", className: "2ème Secondaire", reason: "Bagarre", sanctionType: "Exclusion", duration: 2, startDate: "2026-11-22", expectedEndDate: "2026-11-24", status: "active", recurrenceNumber: 1 });
  v.set("disciplineSanctions/d4", { schoolId: "school-b", schoolYearId: year, studentId: "p1", studentName: "AUTRE", reason: "x", sanctionType: "y", startDate: "2026-11-25", status: "active" });
  return v;
}
const call = (uid, body = {}, caller = {}) => listPrefectDiscipline({ db: memoryDb(seeded()), caller: { uid, role: "study_director", schoolId: school, ...caller }, body: { schoolId: school, schoolYearId: year, ...body } });

describe("lot P2 : discipline du Préfet d'études en lecture seule (serveur)", () => {
  it("renvoie seulement les sanctions des élèves de SES sections, de son école, les plus récentes d'abord", async () => {
    const { sanctions } = await call("prefet");
    expect(sanctions.map((item) => item.id)).toEqual(["d1", "d2"]);
    expect(sanctions[0]).toMatchObject({ studentName: "KABEYA Grâce", className: "3ème Primaire", reason: "Retards répétés", sanctionType: "Avertissement", status: "active", recurrenceNumber: 2 });
    expect(sanctions[1]).toMatchObject({ status: "completed", actualEndDate: "2026-11-19" });
  });

  it("ne renvoie ni la description, ni l'observation, ni l'auteur de la sanction", async () => {
    const text = JSON.stringify(await call("prefet"));
    for (const hidden of ["détail interne", "note privée", "disc-1", "Directeur Discipline", "MUKENDI", "AUTRE"]) expect(text).not.toContain(hidden);
  });

  it("refuse le Directeur des études, un autre rôle et une autre école", async () => {
    await expect(call("directeur")).rejects.toMatchObject({ status: 403 });
    await expect(call("prefet", {}, { role: "discipline_director" })).rejects.toMatchObject({ status: 403 });
    await expect(call("prefet", { schoolId: "school-b" })).rejects.toMatchObject({ status: 403 });
  });

  it("le point d'entrée existant porte l'action, sans nouveau fichier api/", () => {
    const source = readFileSync(new URL("../manage-teacher-grading.js", import.meta.url), "utf8");
    expect(source).toContain('action === "prefect-discipline"');
    expect(source).toContain("listPrefectDiscipline");
  });
});
