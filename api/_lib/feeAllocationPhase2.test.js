import { describe, expect, it } from "vitest";
import { manageFeeAllocationPhase2 } from "./feeAllocationPhase2.js";
import { manageFeeAllocationPhase1 } from "./feeAllocationPhase1.js";
import { assertFeeAllocationMovement } from "./feeAllocationMath.js";
import { inspectFeeAllocationOpeningEvidence } from "./feeAllocationOpeningEvidence.js";

const admin = { uid: "a", role: "school_admin", schoolId: "s" };
const readers = [{ uid: "c", role: "cashier", schoolId: "s" }, { uid: "co", role: "coordination_admin", coordinationId: "co" }, { uid: "sub", role: "sub_coordination_admin", coordinationId: "co", subCoordinationId: "sub" }];
const rubrics = [{ id: "a".repeat(32), name: "Fonctionnement", mode: "percent", basisPoints: 2000 }, { id: "b".repeat(32), name: "Salaire", mode: "fixed", fixedMinor: 3000 }, { id: "c".repeat(32), name: "Prime", mode: "percent", basisPoints: 2500 }];
const body = { action: "save-drafts", schoolYearId: "y", baseFeeTypeId: "f1", targets: [{ feeTypeId: "f1", expectedRevision: 0 }, { feeTypeId: "f2", expectedRevision: 0 }], requestId: "request-phase2-1", rubrics };
function fixture() {
  const records = new Map(Object.entries({
    "users/a": { ...admin, active: true }, "users/c": { ...readers[0], active: true }, "users/co": { ...readers[1], active: true }, "users/sub": { ...readers[2], active: true },
    "schools/s": { name: "Fictive", status: "active", activeSchoolYearId: "y", currency: "USD", activeCoordinationId: "co" },
    "schools/other": { status: "active", activeSchoolYearId: "other-year", currency: "CDF" },
    "schoolYears/y": { schoolId: "s", name: "2026", status: "active", currency: "USD" },
    "feeTypes/f1": { schoolId: "s", schoolYearId: "y", name: "Minerval", className: "1ère", classOptionKey: "1ère::option::A", amount: 100 },
    "feeTypes/f2": { schoolId: "s", schoolYearId: "y", name: "Minerval", className: "2ème", classOptionKey: "2ème::option::B", amount: 200 },
    "feeTypes/foreign": { schoolId: "other", schoolYearId: "y", name: "Minerval", className: "1ère", amount: 100 },
    "coordinations/co": { status: "active" }, "coordinationSchools/co__s": { schoolId: "s", active: true },
    "subCoordinations/sub": { coordinationId: "co", coordinatorUserId: "sub", active: true }, "subCoordinationSchools/sub__s": { schoolId: "s", coordinationId: "co", active: true },
  }));
  const snap = (path) => ({ id: path.split("/").at(-1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const query = (collection, filters = []) => ({ where: (field, op, value) => { expect(op).toBe("=="); return query(collection, [...filters, [field, value]]); }, get: async () => ({ docs: [...records.keys()].filter((path) => path.startsWith(`${collection}/`) && filters.every(([field, value]) => records.get(path)[field] === value)).map(snap) }) });
  return { records, doc: (path) => ({ path, get: async () => snap(path) }), collection: query,
    runTransaction: async (fn) => { const changes = []; let writes = false;
      const result = await fn({ get: async (ref) => { if (writes) throw Error("read after write"); return snap(ref.path); },
        create: (ref, data) => { writes = true; if (records.has(ref.path)) throw Error("already exists"); changes.push([ref.path, data]); },
        update: (ref, data) => { writes = true; if (!records.has(ref.path)) throw Error("missing"); changes.push([ref.path, { ...records.get(ref.path), ...data }]); } });
      changes.forEach(([path, data]) => records.set(path, data)); return result; },
  };
}
const call = (db, input = body, caller = admin) => manageFeeAllocationPhase2({ db, caller, body: input });
describe("phase 2 : brouillons atomiques, isolation et versions", () => {
  it("calcule deux tarifs sans toucher à la caisse, puis conserve les versions", async () => {
    const db = fixture(); const result = await call(db);
    expect(result.configs.map((c) => c.draft.feeAmountMinor)).toEqual([10000, 20000]);
    expect(result.operational).toBe(false);
    const version = await manageFeeAllocationPhase1({ db, caller: admin, body: { action: "prepare-version", feeTypeId: "f1", expectedRevision: 1, requestId: "prepare-version-1" } });
    const prior = structuredClone(version.version);
    await call(db, { ...body, requestId: "request-phase2-2", targets: [{ feeTypeId: "f1", expectedRevision: 1 }], rubrics: [{ ...rubrics[0], basisPoints: 1000 }] });
    expect(db.records.get(`feeAllocationVersions/${prior.id}`)).toEqual(prior);
    expect([...db.records.keys()].filter((p) => /^(payments|expenses|payroll|feeAllocationMovements|feeAllocationBalances|feeAllocationFeeGuards)\//.test(p))).toEqual([]);
  });
  it.each(readers)("autorise la lecture seule de $role", async (reader) => {
    const db = fixture(); await call(db);
    const read = await call(db, { action: "get-workspace", schoolId: "s" }, reader);
    expect(read.configs).toHaveLength(2); expect(read.canConfigure).toBe(false);
    await expect(call(db, body, reader)).rejects.toMatchObject({ status: 403 });
    await expect(call(db, { action: "get-workspace", schoolId: "other" }, reader)).rejects.toMatchObject({ status: 403 });
  });
  it("refuse les comptes désactivés et les relations retirées", async () => {
    const db = fixture(); db.records.get("users/a").active = false;
    await expect(call(db)).rejects.toMatchObject({ status: 403 });
    db.records.get("subCoordinationSchools/sub__s").active = false;
    await expect(call(db, { action: "get-workspace", schoolId: "s" }, readers[2])).rejects.toMatchObject({ status: 403 });
  });
  it("confirme la réponse perdue sans doublon même après changement d'année", async () => {
    const db = fixture(); await call(db); const count = db.records.size;
    db.records.get("schools/s").activeSchoolYearId = "next";
    expect((await call(db)).idempotent).toBe(true); expect(db.records.size).toBe(count);
    await expect(call(db, { ...body, rubrics: [rubrics[0]] })).rejects.toMatchObject({ status: 409 });
  });
  it.each(["foreign", "missing", "wrong-year", "wrong-name"])("refuse la cible %s sans écriture partielle", async (feeId) => {
    const db = fixture(); db.records.set("feeTypes/wrong-year", { ...db.records.get("feeTypes/f2"), schoolYearId: "old" });
    db.records.set("feeTypes/wrong-name", { ...db.records.get("feeTypes/f2"), name: "Autre frais" }); const before = [...db.records];
    await expect(call(db, { ...body, targets: [body.targets[0], { feeTypeId: feeId, expectedRevision: 0 }] })).rejects.toMatchObject({ status: 403 });
    expect([...db.records]).toEqual(before);
  });
  it("refuse doublons, dépassement d'un tarif et révision concurrente atomiquement", async () => {
    const db = fixture(); await expect(call(db, { ...body, targets: [body.targets[0], body.targets[0]] })).rejects.toMatchObject({ status: 400 });
    db.records.get("feeTypes/f2").amount = 20;
    await expect(call(db)).rejects.toMatchObject({ status: 400 }); expect([...db.records.keys()].filter((p) => p.startsWith("feeAllocation"))).toEqual([]);
    db.records.get("feeTypes/f2").amount = 200; await call(db); const before = [...db.records];
    await expect(call(db, { ...body, requestId: "concurrent-request", targets: [{ feeTypeId: "f1", expectedRevision: 1 }, { feeTypeId: "f2", expectedRevision: 0 }] })).rejects.toMatchObject({ status: 409 });
    expect([...db.records]).toEqual(before);
  });
  it("bloque activation et champs opérationnels injectés", async () => {
    const db = fixture(); await expect(call(db, { ...body, status: "ACTIVE" })).rejects.toMatchObject({ status: 400 });
    await expect(manageFeeAllocationPhase1({ db, caller: admin, body: { action: "activate" } })).rejects.toMatchObject({ code: "phase-not-ready" });
  });
});
describe("conditions bloquantes avant future activation", () => {
  it("A : une clé rubrique unique par mouvement, y compris Non affecté", () => {
    for (const rubricId of ["a".repeat(32), "UNALLOCATED"]) expect(() => assertFeeAllocationMovement({ sourceType: "payment", sourceId: "p", sourceRevision: "1", amountMinor: 100, lines: [{ rubricId, amountMinor: 50 }, { rubricId, amountMinor: 50 }] })).toThrow("qu'une fois");
  });
  const proposal = { schoolId: "s", collectionSchoolYearId: "y", currency: "USD", cutoffAt: "2026-11-13", reconciledBy: "a", cashAvailableMinor: 10000, justifiedSchoolFeeMinor: 10000, proposedOpeningMinor: 9000, evidence: [{ collection: "payments", id: "p" }] };
  function evidenceDb() { const db = fixture(); db.records.set("students/student", { schoolId: "s" }); db.records.set("payments/p", { schoolId: "s", schoolYearId: "y", studentId: "student", feeTypeId: "f1", currency: "USD", amount: 100, paidAt: "2026-11-12T12:00:00Z" }); return db; }
  it("B : lit les pièces, trace leur empreinte mais n'approuve jamais un solde", async () => {
    const db = evidenceDb(); const before = [...db.records]; const result = await inspectFeeAllocationOpeningEvidence({ db, proposal });
    expect(result).toMatchObject({ approved: false, eligibleForReview: false, activationBlocked: true, evidenceVerified: true }); expect(result.digest).toMatch(/^[a-f0-9]{64}$/); expect([...db.records]).toEqual(before);
  });
  it.each([{ schoolId: "other" }, { currency: "CDF" }, { amount: 10 }, { paidAt: "2026-11-14" }, { status: "cancelled" }, { studentId: "missing" }])("B : refuse la preuve incohérente %j", async (change) => {
    const db = evidenceDb(); Object.assign(db.records.get("payments/p"), change);
    await expect(inspectFeeAllocationOpeningEvidence({ db, proposal })).rejects.toMatchObject({ code: "evidence-unverified" });
  });
});
