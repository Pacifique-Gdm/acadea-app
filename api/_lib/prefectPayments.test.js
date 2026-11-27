import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { computePrefectPayments, loadPrefectPayments } from "./prefectPayments.js";

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
  v.set(`schools/${school}`, { status: "active" });
  v.set(`schoolYears/${year}`, { schoolId: school, status: "active" });
  v.set("users/prefet", { role: "study_director", schoolId: school, studyFunction: "prefect_of_studies", sectionIds: ["Primaire"] });
  v.set("users/directeur", { role: "study_director", schoolId: school, sectionIds: ["Primaire"] });
  for (const [id, className] of [["p1", "1ère Primaire"], ["p2", "1ère Primaire"], ["p3", "1ère Primaire"], ["p4", "3ème Primaire"]]) {
    v.set(`students/${id}`, { ...base, nom: `NOM-${id}`, className, section: "Primaire", status: "ACTIVE" });
  }
  v.set("students/s1", { ...base, nom: "SECONDAIRE", className: "2ème Secondaire", section: "Secondaire", status: "ACTIVE" });
  v.set("students/old", { ...base, nom: "PARTI", className: "1ère Primaire", section: "Primaire", status: "TRANSFERRED" });
  return v;
}
const arrears = { p1: { USD: 0, CDF: 0 }, p2: { USD: 120, CDF: 0 }, p3: { USD: 0, CDF: 0 }, p4: { USD: 0, CDF: 5000 }, s1: { USD: 999, CDF: 0 } };
const loader = vi.fn(async ({ studentIds }) => ({ totals: Object.fromEntries(studentIds.map((id) => [id, arrears[id]])) }));
const call = (uid, values = seeded(), arrearsLoader = loader) => loadPrefectPayments({ db: memoryDb(values), caller: { uid, role: "study_director", schoolId: school }, body: base, arrearsLoader });

describe("lot P4 : situation des paiements du Préfet d'études, sans montant (serveur)", () => {
  it("par classe de SES sections : % en ordre (aucun reste) et % en retard (un reste)", async () => {
    const result = await call("prefet");
    expect(result.classes).toEqual([
      { className: "1ère Primaire", students: 3, upToDate: 2, late: 1, unknown: 0, upToDateRate: 67, lateRate: 33 },
      { className: "3ème Primaire", students: 1, upToDate: 0, late: 1, unknown: 0, upToDateRate: 0, lateRate: 100 },
    ]);
    expect(result.overall).toEqual({ students: 4, upToDate: 2, late: 2, unknown: 0, upToDateRate: 50 });
  });

  it("le calcul des arriérés de la caisse est demandé seulement pour les élèves actifs de ses sections", async () => {
    loader.mockClear();
    await call("prefet");
    expect(loader.mock.calls.flatMap(([input]) => input.studentIds).sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(loader.mock.calls[0][0].schoolIds).toEqual([school]);
  });

  it("ne renvoie aucun montant ni aucun nom d'élève", async () => {
    const text = JSON.stringify(await call("prefet"));
    expect(text).not.toContain("NOM-");
    expect(text).not.toContain("SECONDAIRE");
    expect(text).not.toContain("120");
    expect(text).not.toContain("5000");
    expect(text).not.toMatch(/USD|CDF|amount|montant/i);
  });

  it("calcul impossible : élèves « non calculés », jamais comptés en ordre", async () => {
    const result = await call("prefet", seeded(), async () => { throw new Error("contexte"); });
    expect(result.overall).toEqual({ students: 4, upToDate: 0, late: 0, unknown: 4, upToDateRate: null });
  });

  it("refuse le Directeur des études et un autre rôle ; Préfet sans section : liste vide", async () => {
    await expect(call("directeur")).rejects.toMatchObject({ status: 403 });
    await expect(loadPrefectPayments({ db: memoryDb(seeded()), caller: { uid: "prefet", role: "cashier", schoolId: school }, body: base, arrearsLoader: loader })).rejects.toMatchObject({ status: 403 });
    const values = seeded();
    values.set("users/prefet", { role: "study_director", schoolId: school, studyFunction: "prefect_of_studies" });
    expect((await call("prefet", values)).classes).toEqual([]);
  });

  it("calcul pur : un total invalide est « non calculé »", () => {
    const result = computePrefectPayments({ sections: ["Primaire"], students: [{ id: "a", section: "Primaire", className: "X" }], totals: { a: { USD: Number.NaN, CDF: 0 } } });
    expect(result.classes[0]).toMatchObject({ unknown: 1, upToDate: 0, late: 0 });
  });

  it("le point d'entrée existant porte l'action, sans nouveau fichier api/", () => {
    const source = readFileSync(new URL("../manage-teacher-grading.js", import.meta.url), "utf8");
    expect(source).toContain('action === "prefect-payments"');
    expect(source).toContain("loadPrefectPayments");
  });
});
