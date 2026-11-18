// Lot matricules — un matricule n'est jamais donné deux fois : numéro calculé sur toute l'école (toutes années),
// compteur unique par école et par préfixe ; deux inscriptions simultanées reçoivent deux numéros différents.
import { describe, expect, it } from "vitest";
import { saveManualStudent } from "./manualStudentSave.js";

const caller = { uid: "secretary-a", role: "secretary", schoolId: "school-a" };
const student = (id, nom) => ({ id: `student-${id.padEnd(32, "0")}`, schoolId: "school-a", schoolYearId: "year-new", classId: "class-a", className: "1ère Primaire",
  nom, postnom: "Test", prenom: "Élève", sexe: "F", birthDate: "2015-04-05", status: "ACTIVE" });
const create = (db, id, nom) => saveManualStudent({ db, caller, body: { intent: "create", clientRequestId: id.padEnd(32, "0"), student: student(id, nom) } });

/** Base en mémoire avec concurrence optimiste (comme Firestore) : une transaction dont un document lu a changé
 * avant la validation est rejouée. */
function fixture(extraRows = []) {
  const rows = new Map([
    ["users/secretary-a", { role: "secretary", schoolId: "school-a", active: true }],
    ["schools/school-a", { status: "active", activeSchoolYearId: "year-new" }],
    ["schoolYears/year-new", { name: "2027-2028", schoolId: "school-a", status: "active" }],
    ["schoolYears/year-old", { name: "Essai 2027-2028 (ne pas utiliser)", schoolId: "school-a", status: "archived" }],
    ["classes/class-a", { name: "1ère Primaire", schoolId: "school-a", schoolYearId: "year-new", active: true }],
    ...extraRows,
  ]);
  const versions = new Map();
  const snapshot = (path) => ({ id: path.split("/").at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const db = {
    doc: (path) => ({ path }),
    collection: (collection) => {
      const filters = [];
      const query = { where(field, op, value) { filters.push([field, op, value]); return query; }, collection, filters };
      return query;
    },
    runTransaction: async (callback) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const seen = new Map(), writes = [];
        const result = await callback({
          get: async (ref) => {
            await Promise.resolve(); await Promise.resolve();
            if (ref.path) { seen.set(ref.path, versions.get(ref.path) ?? 0); return snapshot(ref.path); }
            return { docs: [...rows.keys()].filter((path) => path.startsWith(`${ref.collection}/`))
              .filter((path) => ref.filters.every(([field, op, value]) => { const v = rows.get(path)?.[field];
                return op === ">=" ? v >= value : op === "<" ? v < value : v === value; })).map(snapshot) };
          },
          set: (ref, data) => writes.push([ref.path, data]), create: (ref, data) => writes.push([ref.path, data]), delete: (ref) => writes.push([ref.path, null]),
        });
        if ([...seen].some(([path, version]) => (versions.get(path) ?? 0) !== version)) continue; // conflit : rejouée
        for (const [path, data] of writes) { if (data) rows.set(path, data); else rows.delete(path); versions.set(path, (versions.get(path) ?? 0) + 1); }
        return result;
      }
      throw new Error("Trop de conflits.");
    },
  };
  return { db, rows };
}
const matricules = (rows) => [...rows].filter(([path]) => path.startsWith("students/")).map(([, data]) => data.matricule);

describe("lot matricules — jamais deux fois le même numéro", () => {
  it("un numéro déjà donné dans une AUTRE année de l'école n'est pas redonné", async () => {
    const old = [1, 2, 3].map((n) => [`students/old-${n}`, { schoolId: "school-a", schoolYearId: "year-old", matricule: `ACD-27-000${n}`, nom: `Ancien ${n}`, status: "ACTIVE" }]);
    const { db, rows } = fixture(old);
    const { student: created } = await create(db, "a1", "Nouveau");
    expect(created.matricule).toBe("ACD-27-0004");
    expect(new Set(matricules(rows)).size).toBe(matricules(rows).length);
    expect(rows.get("studentMatriculeCounters/school-a__prefix__ACD-27")).toMatchObject({ lastAllocated: 4, prefix: "ACD-27" });
  });
  it("deux inscriptions simultanées reçoivent deux numéros différents", async () => {
    const { db, rows } = fixture();
    const [first, second] = await Promise.all([create(db, "b1", "Premier"), create(db, "b2", "Second")]);
    expect(first.student.matricule).not.toBe(second.student.matricule);
    expect(matricules(rows).sort()).toEqual(["ACD-27-0001", "ACD-27-0002"]);
  });
  it("le compteur continue d'une année à l'autre pour le même préfixe", async () => {
    const { db, rows } = fixture([["studentMatriculeCounters/school-a__prefix__ACD-27", { schoolId: "school-a", prefix: "ACD-27", lastAllocated: 194 }]]);
    expect((await create(db, "c1", "Suivant")).student.matricule).toBe("ACD-27-0195");
    expect(rows.get("studentMatriculeCounters/school-a__prefix__ACD-27").lastAllocated).toBe(195);
  });
});
