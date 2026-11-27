import { describe, expect, it } from "vitest";
import { authoritySections, authoritySectionsFor, comparableSection } from "./studySectionScope.js";
import { reviewAvailabilityRequest } from "./teacherAvailabilityRequests.js";
import { readDisciplineClasses } from "./disciplineClassesRead.js";

// Lot B : alignement des contrôles serveur sur la règle unique des sections.
// Compte sans section, ou dont les sections couvrent toutes celles de l'école : toute l'école.
// Sinon : seulement ses sections. Un compte aux sections invalides n'est jamais élargi.
type Value = Record<string, unknown>;

describe("authoritySections", () => {
  const mixte = { schoolType: "Mixte" };
  it("sans section : toute l'école (liste vide)", () => {
    expect(authoritySections({}, mixte)).toEqual([]);
    expect(authoritySections({ sectionIds: [] }, mixte)).toEqual([]);
  });
  it("sections couvrant toute l'école : toute l'école", () => {
    expect(authoritySections({ sectionIds: ["CTEB", "Secondaire"] }, { schoolType: "CTEB et Secondaire" })).toEqual([]);
    expect(authoritySections({ section: "Primaire" }, { schoolType: "Primaire uniquement" })).toEqual([]);
  });
  it("une partie des sections : ses sections", () => {
    expect(authoritySections({ sectionIds: ["Primaire"] }, mixte)).toEqual(["Primaire"]);
    expect(authoritySections({ sectionIds: ["cetb"] }, mixte)).toEqual(["CTEB"]);
  });
  it("sections absentes de l'école : reste limité à ses propres sections", () => {
    expect(authoritySections({ sectionIds: ["Maternelle"] }, { schoolType: "CTEB et Secondaire" })).toEqual(["Maternelle"]);
  });
  it("sections invalides : jamais élargi", () => {
    expect(authoritySections({ sectionIds: ["Lycée"] }, mixte)).toEqual(["Lycée"]);
  });
  it("lit l'école seulement si le compte a des sections ; école illisible = prudence", async () => {
    let reads = 0;
    const db = (school: Value | Error) => ({ doc: () => ({ get: async () => { reads += 1; if (school instanceof Error) throw school; return { exists: true, data: () => school }; } }) });
    expect(await authoritySectionsFor(db({ schoolType: "Primaire uniquement" }), {}, "s")).toEqual([]);
    expect(reads).toBe(0);
    expect(await authoritySectionsFor(db({ schoolType: "Primaire uniquement" }), { sectionIds: ["Primaire"] }, "s")).toEqual([]);
    expect(await authoritySectionsFor(db(new Error("réseau")), { sectionIds: ["Primaire"] }, "s")).toEqual(["Primaire"]);
  });
  it("compare les sections des éléments une fois normalisées", () => {
    expect(comparableSection("cteb")).toBe("CTEB");
    expect(comparableSection("Autre")).toBe("Autre");
  });
});

function txDb(seed: Record<string, Value>) {
  const values = new Map(Object.entries(seed));
  const query = (name: string, filters: Array<[string, unknown]> = []): Record<string, unknown> => ({
    collection: name, filters, where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
  });
  const read = (target: { path?: string; collection?: string; filters?: Array<[string, unknown]> }) => {
    if (target.path) return { exists: values.has(target.path), data: () => values.get(target.path as string) };
    return { docs: [...values.entries()].filter(([path, data]) => path.startsWith(`${target.collection}/`)
      && (target.filters ?? []).every(([field, value]) => data[field] === value)).map(([path, data]) => ({ id: path.split("/")[1], data: () => data })) };
  };
  return {
    collection: (name: string) => ({ ...query(name), doc: (id: string) => ({ path: `${name}/${id}` }) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async (target: { path?: string }) => read(target),
      create: () => undefined, update: () => undefined, set: () => undefined,
    }),
  };
}

describe("décision sur une demande d'indisponibilité", () => {
  const seed: Record<string, Value> = {
    "schools/s": { schoolType: "CTEB et Secondaire" },
    "teacherAvailabilityRequests/r": { id: "r", schoolId: "s", schoolYearId: "y", teacherId: "t", userId: "u", requestedDate: "2026-08-11", requestType: "FULL_DAY", reason: "x", status: "PENDING" },
    "schoolYears/y": { id: "y", schoolId: "s", status: "active" },
    // Enseignant dont la section n'est pas une section de l'école.
    "teachers/t": { schoolId: "s", schoolYearId: "y", userId: "u", status: "active" },
    "users/u": { schoolId: "s", role: "teacher", status: "active", active: true, sectionIds: ["Primaire"] },
    "users/d": { schoolId: "s", role: "study_director", status: "active", active: true, sectionIds: ["CTEB", "Secondaire"] },
  };
  const review = (data: Record<string, Value>) => reviewAvailabilityRequest({ db: txDb(data), caller: { uid: "d", role: "study_director", schoolId: "s" }, requestId: "r", action: "REJECT", reviewComment: "Motif" });
  it("un compte couvrant toutes les sections de l'école traite toute l'école", async () => {
    await expect(review(seed)).resolves.toMatchObject({ status: "REJECTED" });
  });
  it("un compte d'une partie des sections reste limité", async () => {
    await expect(review({ ...seed, "users/d": { ...seed["users/d"], sectionIds: ["CTEB"] } })).rejects.toMatchObject({ status: 403 });
  });
});

describe("classes de présence du Directeur de discipline", () => {
  const db = (director: Value, school: Value) => {
    const data = new Map<string, Value>([
      ["users/d", { role: "discipline_director", schoolId: "s", status: "active", ...director }],
      ["schools/s", { status: "active", ...school }], ["schoolYears/y", { schoolId: "s" }],
      ["classes/p", { schoolId: "s", schoolYearId: "y", name: "1ère Primaire" }],
      ["classes/x", { schoolId: "s", schoolYearId: "y", name: "Classe spéciale", section: "Secondaire" }],
    ]);
    return {
      doc(path: string) { return { async get() { return { exists: data.has(path), data: () => data.get(path) }; } }; },
      collection(name: string) {
        const filters: Array<[string, unknown]> = [];
        const query = {
          where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
          limit() { return query; },
          async get() { return { docs: [...data].filter(([path, value]) => path.startsWith(name + "/") && filters.every(([key, val]) => value[key] === val)).map(([path, value]) => ({ id: path.split("/")[1], data: () => value })) }; },
        };
        return query;
      },
    };
  };
  const ids = async (director: Value, school: Value) => (await readDisciplineClasses({ db: db(director, school), caller: { uid: "d", role: "discipline_director", schoolId: "s" }, schoolYearId: "y" })).map((row: { id: string }) => row.id);
  it("compte couvrant toutes les sections de l'école : toutes les classes", async () => {
    expect(await ids({ sectionIds: ["Primaire"] }, { schoolType: "Primaire uniquement" })).toEqual(["p", "x"]);
  });
  it("compte d'une partie des sections : ses classes seulement", async () => {
    expect(await ids({ sectionIds: ["Primaire"] }, { schoolType: "Mixte" })).toEqual(["p"]);
  });
});
