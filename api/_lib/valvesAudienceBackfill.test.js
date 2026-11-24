import { describe, expect, it } from "vitest";
import { applyValvesAudiencePlan, planValvesAudienceBackfill, restoreValvesAudience } from "./valvesAudienceBackfill.js";
import { computeValveAudience } from "../../src/utils/valveAudience.js";

// Fausse base en mémoire : seulement ce que le script utilise. Toute écriture est comptée.
function fakeDb(initial) {
  const data = structuredClone(initial);
  const writes = [];
  const snap = (name, rows) => ({ docs: rows.map(([id, value]) => ({ id, data: () => structuredClone(value), get: (field) => value[field], updateTime: `t-${id}` })) });
  const collection = (name, filters = []) => ({
    where: (field, _op, value) => collection(name, [...filters, [field, value]]),
    select: () => collection(name, filters),
    get: async () => snap(name, Object.entries(data[name] ?? {}).filter(([, value]) => filters.every(([field, expected]) => value[field] === expected))),
  });
  return {
    data, writes,
    collection,
    doc: (path) => {
      const [name, id] = path.split("/");
      return {
        get: async () => ({ exists: Boolean(data[name]?.[id]) }),
        update: async (patch, precondition) => {
          writes.push({ path, patch, precondition });
          for (const [key, value] of Object.entries(patch)) { if (value === "SUPPRIMER") delete data[name][id][key]; else data[name][id][key] = value; }
        },
      };
    },
  };
}

const base = () => ({
  valves: {
    tous: { schoolId: "s1", schoolYearId: "y1", title: "Réunion", visibility: "all_parents" },
    ancienne: { schoolId: "s1", schoolYearId: "y1", title: "Ancienne", visibility: "parents" },
    classe: { schoolId: "s1", schoolYearId: "y1", title: "1ère", visibility: "class", targetClassKey: "1ère Primaire" },
    section: { schoolId: "s1", schoolYearId: "y1", title: "Secondaire", visibility: "Secondaire" },
    sansVisibilite: { schoolId: "s1", schoolYearId: "y1", title: "Sans visibilité" },
    dejaFaite: { schoolId: "s1", schoolYearId: "y1", title: "Déjà", visibility: "all_parents", audienceAll: true, audienceParentIds: [] },
    autreEcole: { schoolId: "s2", schoolYearId: "y2", title: "Autre école", visibility: "class", targetClassKey: "1ère Primaire" },
  },
  parents: {
    pa: { schoolId: "s1", studentIds: ["ea"] },
    pb: { schoolId: "s1", studentIds: ["eb"] },
    pc: { schoolId: "s1", studentIds: ["ec"] },
    px: { schoolId: "s2", studentIds: ["ex"] },
  },
  students: {
    ea: { schoolId: "s1", schoolYearId: "y1", parentId: "pa", className: "1ère Primaire", status: "ACTIVE" },
    eb: { schoolId: "s1", schoolYearId: "y1", parentId: "pb", className: "1ère Humanité", status: "ACTIVE" },
    ec: { schoolId: "s1", schoolYearId: "y1", parentId: "pc", className: "1ère Primaire", status: "TRANSFERRED" },
    ex: { schoolId: "s2", schoolYearId: "y2", parentId: "px", className: "1ère Primaire", status: "ACTIVE" },
  },
});

describe("reprise des Valves : lecture seule par défaut", () => {
  it("compte les Valves, calcule le public comme l'écran et n'écrit rien", async () => {
    const db = fakeDb(base());
    const plan = await planValvesAudienceBackfill({ db });
    expect(db.writes).toEqual([]);
    expect(plan.totals).toMatchObject({ valves: 7, dejaFaites: 1, aCompleter: 6, tous: 2, douteuses: 1 });
    const ajout = Object.fromEntries(plan.ecritures.map((item) => [item.valveId, item.ajout]));
    expect(ajout.tous).toEqual({ audienceAll: true, audienceParentIds: [] });
    expect(ajout.ancienne).toEqual({ audienceAll: true, audienceParentIds: [] }); // déjà montrée à tous aujourd'hui
    expect(ajout.classe).toEqual({ audienceAll: false, audienceParentIds: ["pa"] }); // pas l'enfant transféré
    expect(ajout.section).toEqual({ audienceAll: false, audienceParentIds: ["pb"] });
    expect(ajout.sansVisibilite).toEqual({ audienceAll: false, audienceParentIds: [] }); // jamais mise en « tous »
    expect(ajout.autreEcole).toEqual({ audienceAll: false, audienceParentIds: ["px"] }); // pas de parent d'une autre école
    expect(plan.douteuses).toEqual([expect.objectContaining({ valveId: "sansVisibilite", motif: "visibilité absente", decision: "fermée (aucun parent)" })]);
  });

  it("une seule école si --school est donné", async () => {
    const plan = await planValvesAudienceBackfill({ db: fakeDb(base()), schoolId: "s2" });
    expect(plan.totals.valves).toBe(1);
  });
});

describe("reprise des Valves : écriture puis retour arrière", () => {
  it("écrit seulement les deux champs, avec la précondition « inchangée », puis plus rien à faire", async () => {
    const db = fakeDb(base());
    const plan = await planValvesAudienceBackfill({ db });
    const result = await applyValvesAudiencePlan({ db, plan });
    expect(result).toEqual({ ecrites: 6, ignorees: [] });
    expect(db.writes.every((write) => Object.keys(write.patch).sort().join() === "audienceAll,audienceParentIds" && write.precondition?.lastUpdateTime)).toBe(true);
    expect((await planValvesAudienceBackfill({ db })).totals.aCompleter).toBe(0);
  });

  it("le retour arrière remet chaque Valve sauvegardée comme avant", async () => {
    const db = fakeDb(base());
    const plan = await planValvesAudienceBackfill({ db });
    const backup = { valves: plan.ecritures.map((item) => ({ id: item.valveId, ...item.original })) };
    await applyValvesAudiencePlan({ db, plan });
    await restoreValvesAudience({ db, backup, deleteField: () => "SUPPRIMER" });
    for (const id of Object.keys(base().valves)) expect(db.data.valves[id]).toEqual(base().valves[id]);
  });
});

describe("le public calculé à la publication est le même que celui de la reprise", () => {
  it("même fonction partagée", () => {
    const { parents, students } = base();
    const list = (rows) => Object.entries(rows).map(([id, value]) => ({ id, ...value }));
    expect(computeValveAudience(base().valves.classe, list(parents), list(students))).toEqual({ audienceAll: false, audienceParentIds: ["pa"] });
  });
});
