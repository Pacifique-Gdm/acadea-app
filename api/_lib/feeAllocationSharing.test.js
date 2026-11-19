import { describe, expect, it } from "vitest";
import { filterWorkspaceForStaff, manageFeeAllocationSharing, sharedRubricIds, sharesId } from "./feeAllocationSharing.js";

const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);
function fakeDb(extra = {}) {
  const records = new Map(Object.entries({
    "schools/s": { status: "active", activeSchoolYearId: "y", currency: "USD", name: "École fictive" },
    "schoolYears/y": { schoolId: "s", status: "active", currency: "USD", name: "2026-2027" },
    "users/admin": { role: "school_admin", schoolId: "s", active: true, name: "Admin" },
    "users/dd": { role: "discipline_director", schoolId: "s", active: true, name: "Directeur fictif" },
    "users/se": { role: "secretary", schoolId: "s", active: true, name: "Secrétaire fictive" },
    "users/te": { role: "teacher", schoolId: "s", active: true, name: "Enseignant fictif" },
    "users/off": { role: "teacher", schoolId: "s", active: false, name: "Ancien" },
    "users/cash": { role: "cashier", schoolId: "s", active: true, name: "Caissier" },
    ["feeAllocationRubrics/" + A]: { schoolId: "s", schoolYearId: "y", name: "Part de l'école" },
    ["feeAllocationRubrics/" + B]: { schoolId: "s", schoolYearId: "y", name: "Part des enseignants" },
    ["feeAllocationRubrics/" + C]: { schoolId: "s", schoolYearId: "y", name: "Part du Promoteur" },
    ...extra,
  }));
  const snap = (path) => ({ id: path.split("/").at(-1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const query = (name, filters = []) => ({
    where: (k, op, v) => query(name, [...filters, [k, op, v]]), limit: () => query(name, filters),
    get: async () => ({ docs: [...records].filter(([p, d]) => p.split("/").length === 2 && p.startsWith(`${name}/`)
      && filters.every(([k, op, v]) => op === "in" ? v.includes(d[k]) : d[k] === v)).map(([p]) => snap(p)) }),
  });
  const db = { records, doc: (path) => ({ path, get: async () => snap(path) }), collection: query,
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({ get: async (ref) => ref.path ? snap(ref.path) : ref.get(),
        set: (ref, d) => writes.push(["set", ref.path, d]), create: (ref, d) => { if (records.has(ref.path)) throw Error("exists"); writes.push(["set", ref.path, d]); } });
      writes.forEach(([, p, d]) => records.set(p, d));
      return result;
    } };
  return db;
}
const admin = { uid: "admin", role: "school_admin", schoolId: "s" };
let n = 0;
const req = () => `partage-essai-${String(++n).padStart(4, "0")}`;
const share = (db, body) => manageFeeAllocationSharing({ db, caller: admin, body: { schoolId: "s", requestId: req(), ...body } });
const shares = (db) => db.records.get(`feeAllocationShares/${sharesId("s", "y")}`);

describe("partage des rubriques : règles", () => {
  it("tout le personnel (avec exceptions) ou des personnes choisies", () => {
    const doc = { rubrics: { [A]: { all: true, exceptUserIds: ["te"] }, [B]: { all: false, userIds: ["te"] } } };
    expect(sharedRubricIds(doc, "dd")).toEqual([A]);
    expect(sharedRubricIds(doc, "te")).toEqual([B]);
    expect(sharedRubricIds(undefined, "dd")).toEqual([]);
  });
  it("vue du personnel : seulement ses rubriques, aucune donnée d'élève ni de cas social, aucune configuration", () => {
    const workspace = { school: { id: "s" }, year: { id: "y" }, currency: "USD", canConfigure: true, pendingAllocations: 3,
      fees: [{ id: "f", name: "Minerval", className: "7e", classOptionKey: null, amount: 120 }],
      configs: [{ id: "c", schoolId: "s", schoolYearId: "y", feeTypeId: "f", className: "7e", currency: "USD", draftRevision: 2, draft: { rubrics: [{ id: C, name: "Secret" }] }, currentVersionId: "v", socialVersionId: "sv" }],
      forecast: { status: "complete", rows: [{ feeTypeId: "f", rubricId: A, table: 2, amountMinor: 100, socialVersionId: "sv" }, { feeTypeId: "f", rubricId: C, table: 1, amountMinor: 900 }] },
      rubricCatalog: [{ id: A, name: "Part de l'école" }, { id: C, name: "Part du Promoteur" }],
      ledger: { status: "ACTIVE", rubrics: [{ id: A }, { id: C }], balances: [{ rubricId: A }, { rubricId: C }],
        movements: [{ id: "m", sourceType: "payment", type: "receipt", amountMinor: 1000, lines: [{ rubricId: A, amountMinor: 100 }, { rubricId: C, amountMinor: 900 }],
          feeTypeId: "f", originSchoolYearId: "y", postedAt: "2026-11-18", socialCase: true, formerStudent: true, studentId: "eleve-secret", sourceSnapshot: { studentId: "eleve-secret" } },
        { id: "m2", sourceType: "payment", type: "receipt", amountMinor: 50, lines: [{ rubricId: C, amountMinor: 50 }], feeTypeId: "f", originSchoolYearId: "y", postedAt: "2026-11-18" }] } };
    const view = filterWorkspaceForStaff(workspace, [A]);
    const text = JSON.stringify(view);
    expect(text).not.toContain("eleve-secret"); expect(text).not.toContain(C); expect(text).not.toContain("socialCase"); expect(text).not.toContain("Secret");
    expect(view.ledger.movements).toEqual([expect.objectContaining({ id: "m", amountMinor: 100, lines: [{ rubricId: A, amountMinor: 100 }] })]);
    expect(view.forecast.rows).toEqual([{ feeTypeId: "f", rubricId: A, table: 1, amountMinor: 100 }]);
    expect(view.canConfigure).toBe(false); expect(view.pendingAllocations).toBe(0);
  });
});

describe("partage des rubriques : Administrateur", () => {
  it("liste le personnel avec un espace Acadéa (4 rôles, actifs), sans caissier ni compte inactif", async () => {
    const result = await manageFeeAllocationSharing({ db: fakeDb(), caller: admin, body: { action: "get-shares", schoolId: "s" } });
    expect(result.staff.map((s) => s.id).sort()).toEqual(["dd", "se", "te"]);
  });
  it("partage à tout le personnel, puis retire une personne, puis tout le drawer de tout le personnel", async () => {
    const db = fakeDb();
    let r = await share(db, { action: "set-rubric-share", expectedRevision: null, rubricId: A, all: true, userIds: [] });
    expect(sharedRubricIds(shares(db), "te")).toEqual([A]);
    r = await share(db, { action: "revoke-share", expectedRevision: r.revision, target: "te", rubricIds: null });
    expect(sharedRubricIds(shares(db), "te")).toEqual([]); expect(sharedRubricIds(shares(db), "dd")).toEqual([A]);
    await share(db, { action: "revoke-share", expectedRevision: r.revision, target: "all", rubricIds: null });
    expect(shares(db).rubrics).toEqual({});
  });
  it("personnes choisies ; retrait d'une seule rubrique", async () => {
    const db = fakeDb();
    let r = await share(db, { action: "set-rubric-share", expectedRevision: null, rubricId: A, all: false, userIds: ["dd", "se"] });
    r = await share(db, { action: "set-rubric-share", expectedRevision: r.revision, rubricId: B, all: false, userIds: ["dd"] });
    await share(db, { action: "revoke-share", expectedRevision: r.revision, target: "dd", rubricIds: [A] });
    expect(sharedRubricIds(shares(db), "dd")).toEqual([B]); expect(sharedRubricIds(shares(db), "se")).toEqual([A]);
  });
  it("refuse : autre rôle, caissier ou compte inactif choisi, rubrique inconnue, révision dépassée", async () => {
    const db = fakeDb();
    await expect(manageFeeAllocationSharing({ db, caller: { uid: "cash", role: "cashier", schoolId: "s" }, body: { action: "set-rubric-share", schoolId: "s" } })).rejects.toMatchObject({ status: 403 });
    await expect(share(db, { action: "set-rubric-share", expectedRevision: null, rubricId: A, all: false, userIds: ["cash"] })).rejects.toMatchObject({ status: 400 });
    await expect(share(db, { action: "set-rubric-share", expectedRevision: null, rubricId: A, all: false, userIds: ["off"] })).rejects.toMatchObject({ status: 400 });
    await expect(share(db, { action: "set-rubric-share", expectedRevision: null, rubricId: "d".repeat(32), all: true, userIds: [] })).rejects.toMatchObject({ status: 400 });
    await share(db, { action: "set-rubric-share", expectedRevision: null, rubricId: A, all: true, userIds: [] });
    await expect(share(db, { action: "set-rubric-share", expectedRevision: null, rubricId: B, all: true, userIds: [] })).rejects.toMatchObject({ status: 409 });
  });
});

describe("partage des rubriques : personnel", () => {
  it("le personnel voit ses rubriques ; sans partage, l'accès est refusé ; un caissier ne passe pas par ici", async () => {
    const db = fakeDb({ [`feeAllocationShares/${sharesId("s", "y")}`]: { rubrics: { [A]: { all: false, userIds: ["dd"] } }, revision: "r1" } });
    expect((await manageFeeAllocationSharing({ db, caller: { uid: "dd", role: "discipline_director", schoolId: "s" }, body: { action: "get-my-shares" } })).rubricIds).toEqual([A]);
    expect((await manageFeeAllocationSharing({ db, caller: { uid: "se", role: "secretary", schoolId: "s" }, body: { action: "get-my-shares" } })).rubricIds).toEqual([]);
    await expect(manageFeeAllocationSharing({ db, caller: { uid: "se", role: "secretary", schoolId: "s" }, body: { action: "get-shared-workspace" } })).rejects.toMatchObject({ status: 403 });
    await expect(manageFeeAllocationSharing({ db, caller: { uid: "cash", role: "cashier", schoolId: "s" }, body: { action: "get-my-shares" } })).rejects.toMatchObject({ status: 403 });
    await expect(manageFeeAllocationSharing({ db, caller: { uid: "dd", role: "discipline_director", schoolId: "autre" }, body: { action: "get-my-shares" } })).rejects.toMatchObject({ status: 403 });
  });
});
