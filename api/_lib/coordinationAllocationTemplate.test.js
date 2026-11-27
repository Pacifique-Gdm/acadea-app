// Lot 7 — modèle commun de répartition de la Coordination (serveur uniquement).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publishAllocationTemplate, readAllocationTemplate, validateAllocationTemplate } from "./coordinationAllocationTemplate.js";

const caller = { uid: "coord-1", role: "coordination_admin", coordinationId: "coord-a", profile: { name: "Coordinateur fictif" } };
const rubric = (id, name, subRubrics = []) => ({ id, name, subRubrics });
const valid = () => ({
  name: "Modèle 2026-2027",
  rubrics: [rubric("personnel01", "Personnel", [{ id: "enseignant1", name: "Enseignant", basisPoints: 3000 }, { id: "administr1", name: "Administratif", basisPoints: 5000 }]), rubric("fonction001", "Fonctionnement")],
  feeTypes: [{ id: "minerval01", label: "Minerval", allocations: [{ rubricId: "personnel01", basisPoints: 4000 }, { rubricId: "fonction001", basisPoints: 3000 }] }],
  defaultAllocations: [{ rubricId: "fonction001", basisPoints: 6000 }],
});

function fakeDb(initial = {}) {
  const records = new Map(Object.entries(initial));
  const doc = (path) => ({ path, get: async () => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) }) });
  let auto = 0;
  return {
    records,
    doc,
    collection: (name) => ({ doc: () => doc(`${name}/auto-${++auto}`) }),
    runTransaction: async (run) => {
      const writes = [];
      const result = await run({
        get: (ref) => ref.get(),
        set: (ref, data) => writes.push(["set", ref.path, data]),
        create: (ref, data) => { if (records.has(ref.path)) throw new Error("existe déjà"); writes.push(["create", ref.path, data]); },
      });
      writes.forEach(([, path, data]) => records.set(path, structuredClone(data)));
      return result;
    },
  };
}

describe("lot 7 — validation du modèle", () => {
  it("accepte un modèle correct et le normalise (espaces retirés)", () => {
    const input = valid(); input.name = "  Modèle   2026-2027 ";
    expect(validateAllocationTemplate(input)).toEqual({ ...valid(), name: "Modèle 2026-2027" });
  });
  it("refuse plus de 100 %, un nom réservé, un doublon, une rubrique inconnue et un modèle sans rubrique", () => {
    const over = valid(); over.feeTypes[0].allocations[1].basisPoints = 7000;
    expect(() => validateAllocationTemplate(over)).toThrow("dépasse 100 %");
    const subOver = valid(); subOver.rubrics[0].subRubrics[0].basisPoints = 6000;
    expect(() => validateAllocationTemplate(subOver)).toThrow("dépassent 100 %");
    const reserved = valid(); reserved.rubrics[1].name = "Non affecté (Personnel)";
    expect(() => validateAllocationTemplate(reserved)).toThrow("réservé");
    const duplicate = valid(); duplicate.rubrics[1].name = " personnel ";
    expect(() => validateAllocationTemplate(duplicate)).toThrow("même nom");
    const unknown = valid(); unknown.defaultAllocations = [{ rubricId: "inconnue01", basisPoints: 100 }];
    expect(() => validateAllocationTemplate(unknown)).toThrow("Rubrique inconnue");
    expect(() => validateAllocationTemplate({ ...valid(), rubrics: [] })).toThrow("de 1 à 30 rubriques");
  });
  it("refuse un montant fixe ou un pourcentage nul (pourcentages seulement)", () => {
    const fixed = valid(); fixed.feeTypes[0].allocations[0] = { rubricId: "personnel01", fixedMinor: 500 };
    expect(() => validateAllocationTemplate(fixed)).toThrow("pourcentage");
    const zero = valid(); zero.rubrics[0].subRubrics[0].basisPoints = 0;
    expect(() => validateAllocationTemplate(zero)).toThrow("pourcentage");
  });
});

describe("lot 7 — publication et lecture", () => {
  it("publie la version 1 puis 2, garde chaque version figée et écrit l'Historique", async () => {
    const db = fakeDb();
    expect(await readAllocationTemplate({ db, caller })).toEqual({ template: null });
    const first = await publishAllocationTemplate({ db, caller, input: { ...valid(), expectedVersion: 0 }, now: "2026-11-27T10:00:00.000Z" });
    expect(first.template).toMatchObject({ coordinationId: "coord-a", version: 1, name: "Modèle 2026-2027", publishedBy: "coord-1" });
    const second = await publishAllocationTemplate({ db, caller, input: { ...valid(), name: "Modèle B", expectedVersion: 1 }, now: "2026-11-27T11:00:00.000Z" });
    expect(second.template.version).toBe(2);
    expect(db.records.get("coordinationAllocationTemplates/coord-a/versions/1").name).toBe("Modèle 2026-2027");
    expect(db.records.get("coordinationAllocationTemplates/coord-a/versions/2").name).toBe("Modèle B");
    expect((await readAllocationTemplate({ db, caller })).template.version).toBe(2);
    const audits = [...db.records].filter(([path]) => path.startsWith("auditLogs/")).map(([, value]) => value);
    expect(audits.map((a) => a.eventType)).toEqual(["coordination.allocation_template.published", "coordination.allocation_template.published"]);
    expect(audits[1]).toMatchObject({ coordinationId: "coord-a", action: "Modèle de répartition publié (version 2)" });
  });
  it("refuse d'écraser une version publiée entre-temps (409) et ne touche à rien", async () => {
    const db = fakeDb();
    await publishAllocationTemplate({ db, caller, input: { ...valid(), expectedVersion: 0 } });
    const before = structuredClone([...db.records]);
    await expect(publishAllocationTemplate({ db, caller, input: { ...valid(), expectedVersion: 0 } })).rejects.toMatchObject({ statusCode: 409 });
    expect([...db.records]).toEqual(before);
  });
  it("chaque coordination ne voit que son propre modèle", async () => {
    const db = fakeDb();
    await publishAllocationTemplate({ db, caller, input: { ...valid(), expectedVersion: 0 } });
    expect(await readAllocationTemplate({ db, caller: { ...caller, coordinationId: "coord-b" } })).toEqual({ template: null });
  });
});

describe("lot 7 — accès", () => {
  const source = readFileSync(new URL("../manage-coordination.js", import.meta.url), "utf8");
  it("les deux actions passent par requireActiveCoordinator (Coordinateur principal actif seulement)", () => {
    const block = source.slice(source.indexOf('action === "allocation-template-read"'), source.indexOf('if (action === "update-settings")'));
    expect(block).toContain("requireActiveCoordinator(auth, db, token)");
    expect(block).toContain("publishAllocationTemplate({ db, caller, input })");
    expect(block.indexOf("requireActiveCoordinator")).toBeLessThan(block.indexOf("readAllocationTemplate"));
  });
  it("aucune règle Firestore n'ouvre les modèles au navigateur (aucune nouvelle règle)", () => {
    expect(readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8")).not.toContain("coordinationAllocationTemplates");
  });
});
