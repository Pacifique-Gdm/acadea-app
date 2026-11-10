import { describe, expect, it } from "vitest";
import { manageFeeAllocationPhase1 } from "./feeAllocationPhase1.js";
import { UNALLOCATED_RUBRIC_ID, assertFeeAllocationActivationBlocked, assertFeeAllocationMovement, validateFeeAllocationOpeningProposal, validateFeeAllocationRubrics } from "./feeAllocationMath.js";

const rubric = (id, name, mode, amount) => ({ id: id.repeat(32), name, mode, ...(mode === "fixed" ? { fixedMinor: amount } : { basisPoints: amount }) });
const caller = { uid: "admin-a", role: "school_admin", schoolId: "school-a" };
const draft = { action: "save-draft", feeTypeId: "fee-a", requestId: "request-allocation-a", expectedRevision: 0,
  rubrics: [rubric("a", "Bibliothèque", "fixed", 3000), rubric("b", "Laboratoire", "percent", 2500)] };

function fakeDb() {
  const records = new Map([
    ["users/admin-a", { role: "school_admin", schoolId: "school-a", active: true }],
    ["users/cashier-a", { role: "cashier", schoolId: "school-a", active: true }],
    ["users/admin-b", { role: "school_admin", schoolId: "school-b", active: true }],
    ["schools/school-a", { status: "active", activeSchoolYearId: "year-a", currency: "CDF", activeCoordinationId: "coord-a" }],
    ["schools/school-b", { status: "active", activeSchoolYearId: "year-b", currency: "USD" }],
    ["schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF" }],
    ["schoolYears/year-b", { schoolId: "school-b", status: "active", currency: "USD" }],
    ["feeTypes/fee-a", { schoolId: "school-a", schoolYearId: "year-a", className: "6ème Primaire", classOptionKey: "6ème Primaire::option::A", amount: 100 }],
    ["feeTypes/foreign", { schoolId: "school-b", schoolYearId: "year-b", className: "1ère", amount: 100 }],
    ["coordinations/coord-a", { status: "active" }],
    ["coordinationSchools/coord-a__school-a", { schoolId: "school-a", active: true }],
    ["users/coord-a", { role: "coordination_admin", coordinationId: "coord-a", active: true }],
    ["users/sub-a", { role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", active: true }],
    ["subCoordinations/sub-a", { id: "sub-a", coordinationId: "coord-a", coordinatorUserId: "sub-a", active: true, status: "active" }],
    ["subCoordinationSchools/sub-a__school-a", { schoolId: "school-a", coordinationId: "coord-a", active: true }],
  ]);
  const snapshot = (path) => ({ id: path.split("/").at(-1), exists: records.has(path), data: () => records.get(path) });
  const queryResult = (name, filters) => ({ docs: [...records.keys()].filter((path) => path.startsWith(`${name}/`) && filters.every(([field, value]) => records.get(path)?.[field] === value)).map(snapshot) });
  return { records,
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    collection: (name) => ({ where: (field, _op, value) => ({ where: (second, _secondOp, secondValue) => ({ get: async () => queryResult(name, [[field, value], [second, secondValue]]) }), get: async () => queryResult(name, [[field, value]]) }) }),
    runTransaction: async (work) => {
      const changes = [];
      const tx = {
        get: async (ref) => snapshot(ref.path),
        create: (ref, value) => changes.push(["create", ref.path, value]),
        update: (ref, value) => changes.push(["update", ref.path, value]),
      };
      const result = await work(tx);
      for (const [kind, path] of changes) if (kind === "create" && records.has(path)) throw new Error("already exists");
      for (const [kind, path, value] of changes) records.set(path, kind === "update" ? { ...records.get(path), ...value } : value);
      return result;
    },
  };
}

describe("fondations de répartition : calculs et états non opérationnels", () => {
  it("conserve les unités entières, les modes mixtes et le reste Non affecté", () => {
    const result = validateFeeAllocationRubrics(draft.rubrics, 10000);
    expect(result.shares).toEqual([
      { rubricId: "a".repeat(32), amountMinor: 3000 },
      { rubricId: "b".repeat(32), amountMinor: 2500 },
      { rubricId: UNALLOCATED_RUBRIC_ID, amountMinor: 4500 },
    ].sort((a, b) => a.rubricId.localeCompare(b.rubricId)));
    expect(result.shares.reduce((sum, part) => sum + part.amountMinor, 0)).toBe(10000);
    expect(validateFeeAllocationRubrics([rubric("c", "A", "percent", 10000)], 101).unallocatedMinor).toBe(0);
    expect(validateFeeAllocationRubrics([rubric("c", "A", "percent", 3333)], 101).shares.reduce((sum, part) => sum + part.amountMinor, 0)).toBe(101);
  });
  it("refuse les doublons, les rubriques réservées et tout dépassement", () => {
    expect(() => validateFeeAllocationRubrics([rubric("a", "A", "fixed", 10001)], 10000)).toThrow();
    expect(() => validateFeeAllocationRubrics([rubric("a", "A", "percent", 7000), rubric("b", "B", "percent", 4000)], 10000)).toThrow();
    expect(() => validateFeeAllocationRubrics([rubric("a", "A", "fixed", 1), rubric("a", "B", "fixed", 1)], 10000)).toThrow();
    expect(() => validateFeeAllocationRubrics([rubric("a", "Non affecté", "fixed", 1)], 10000)).toThrow();
  });
  it("calcule indépendamment les tarifs de 100 et 200 USD avec fixe et pourcentage", () => {
    const rubrics = [rubric("a", "Fonctionnement", "percent", 2000), rubric("b", "Salaire", "fixed", 3000), rubric("c", "Prime", "percent", 2500)];
    const amounts = (fee) => Object.fromEntries(validateFeeAllocationRubrics(rubrics, fee).shares.map((part) => [part.rubricId, part.amountMinor]));
    expect(amounts(10000)).toMatchObject({ ["a".repeat(32)]: 2000, ["b".repeat(32)]: 3000, ["c".repeat(32)]: 2500, [UNALLOCATED_RUBRIC_ID]: 2500 });
    expect(amounts(20000)).toMatchObject({ ["a".repeat(32)]: 4000, ["b".repeat(32)]: 3000, ["c".repeat(32)]: 5000, [UNALLOCATED_RUBRIC_ID]: 8000 });
  });
  it("refuse un solde d'ouverture supérieur aux fonds justifiés et ne l'approuve jamais", () => {
    const cutoffAt = "2026-11-09";
    const evidence = [{ collection: "payments", id: "payment-old" }];
    expect(() => validateFeeAllocationOpeningProposal({ cutoffAt, cashAvailableMinor: 3000, justifiedSchoolFeeMinor: 2000, proposedOpeningMinor: 3000, evidence })).toThrow();
    expect(validateFeeAllocationOpeningProposal({ cutoffAt, cashAvailableMinor: 3000, justifiedSchoolFeeMinor: 2000, proposedOpeningMinor: 2000, evidence })).toMatchObject({ approved: false });
    expect(() => validateFeeAllocationOpeningProposal({ cutoffAt, cashAvailableMinor: 3000, justifiedSchoolFeeMinor: 2000, proposedOpeningMinor: 1000, evidence: [] })).toThrow();
  });
  it("valide la conservation des mouvements futurs, sans les enregistrer", () => {
    const movement = { sourceType: "payment", sourceId: "p", sourceRevision: "1", amountMinor: 100, lines: [{ rubricId: UNALLOCATED_RUBRIC_ID, amountMinor: 100 }] };
    expect(assertFeeAllocationMovement(movement)).toBe(movement);
    expect(() => assertFeeAllocationMovement({ ...movement, lines: [{ rubricId: UNALLOCATED_RUBRIC_ID, amountMinor: 101 }] })).toThrow();
    expect(() => assertFeeAllocationActivationBlocked()).toThrow("La répartition ne peut pas être activée");
  });
});

describe("API de préparation côté serveur", () => {
  it("n'active rien après le brouillon et prépare une version immuable", async () => {
    const db = fakeDb();
    expect((await manageFeeAllocationPhase1({ db, caller, body: { action: "get-state" } })).state.status).toBe("NON_CONFIGURE");
    const first = await manageFeeAllocationPhase1({ db, caller, body: draft });
    expect(first.operational).toBe(false);
    expect((await manageFeeAllocationPhase1({ db, caller, body: draft })).idempotent).toBe(true);
    expect((await manageFeeAllocationPhase1({ db, caller, body: { action: "get-state" } })).state.status).toBe("EN_PREPARATION");
    const prepared = await manageFeeAllocationPhase1({ db, caller, body: { action: "prepare-version", feeTypeId: "fee-a", requestId: "request-version-a", expectedRevision: 1 } });
    expect(prepared.version).toMatchObject({ version: 1, status: "prepared", effectiveFrom: null, feeAmountMinor: 10000, classOptionKey: "6ème Primaire::option::A" });
    expect((await manageFeeAllocationPhase1({ db, caller, body: { action: "prepare-version", feeTypeId: "fee-a", requestId: "request-version-a", expectedRevision: 1 } })).idempotent).toBe(true);
    expect([...db.records.values()].filter((value) => value.status === "ACTIVE")).toHaveLength(0);
    expect([...db.records.keys()].some((key) => key.startsWith("feeAllocationMovements/"))).toBe(false);
  });
  it("refuse l'autre école, les rôles non autorisés, la session inactive et l'activation", async () => {
    const db = fakeDb();
    await expect(manageFeeAllocationPhase1({ db, caller: { ...caller, schoolId: "school-b" }, body: draft })).rejects.toMatchObject({ status: 403 });
    await expect(manageFeeAllocationPhase1({ db, caller: { uid: "cashier-a", role: "cashier", schoolId: "school-a" }, body: draft })).rejects.toMatchObject({ status: 403 });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { ...draft, feeTypeId: "foreign" } })).rejects.toMatchObject({ status: 403 });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { action: "activate" } })).rejects.toMatchObject({ status: 409, code: "phase-not-ready" });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { ...draft, schoolId: "school-b" } })).rejects.toMatchObject({ status: 403 });
    db.records.set("users/admin-a", { role: "school_admin", schoolId: "school-a", status: "inactive" });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { action: "get-state" } })).rejects.toMatchObject({ status: 403 });
  });
  it("permet la lecture au Caissier et à la Coordination de l'école, mais pas à l'enseignant", async () => {
    const db = fakeDb();
    const cashier = { uid: "cashier-a", role: "cashier", schoolId: "school-a" };
    const coord = { uid: "coord-a", role: "coordination_admin", coordinationId: "coord-a" };
    const sub = { uid: "sub-a", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" };
    expect((await manageFeeAllocationPhase1({ db, caller: cashier, body: { action: "get-permissions" } })).canConfigure).toBe(false);
    expect((await manageFeeAllocationPhase1({ db, caller: coord, body: { action: "get-permissions", schoolId: "school-a" } })).canRead).toBe(true);
    expect((await manageFeeAllocationPhase1({ db, caller: sub, body: { action: "get-permissions", schoolId: "school-a" } })).canConfigure).toBe(false);
    await expect(manageFeeAllocationPhase1({ db, caller: coord, body: { action: "get-permissions", schoolId: "school-b" } })).rejects.toMatchObject({ status: 403 });
    db.records.set("users/teacher-a", { role: "teacher", schoolId: "school-a", active: true });
    await expect(manageFeeAllocationPhase1({ db, caller: { uid: "teacher-a", role: "teacher", schoolId: "school-a" }, body: { action: "get-state" } })).rejects.toMatchObject({ status: 403 });
    await expect(manageFeeAllocationPhase1({ db, caller: { uid: "teacher-a", role: "teacher", schoolId: "school-a" }, body: { action: "activate" } })).rejects.toMatchObject({ status: 403 });
  });
  it("refuse les révisions concurrentes et les clés réutilisées avec un autre contenu", async () => {
    const db = fakeDb();
    await manageFeeAllocationPhase1({ db, caller, body: draft });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { ...draft, requestId: "request-allocation-b" } })).rejects.toMatchObject({ status: 409 });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { ...draft, rubrics: [rubric("a", "Autre", "fixed", 10)] } })).rejects.toMatchObject({ status: 409 });
    expect([...db.records.keys()].filter((key) => key.startsWith("feeAllocationConfigs/"))).toHaveLength(1);
  });
  it("refuse un frais manquant, une année inactive et un tarif modifié après brouillon", async () => {
    const db = fakeDb();
    await expect(manageFeeAllocationPhase1({ db, caller, body: { ...draft, feeTypeId: "missing" } })).rejects.toMatchObject({ status: 403 });
    db.records.set("schoolYears/year-a", { schoolId: "school-a", status: "archived", currency: "CDF" });
    await expect(manageFeeAllocationPhase1({ db, caller, body: draft })).rejects.toMatchObject({ status: 409 });
    db.records.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF" });
    await manageFeeAllocationPhase1({ db, caller, body: draft });
    db.records.set("feeTypes/fee-a", { ...db.records.get("feeTypes/fee-a"), amount: 120 });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { action: "prepare-version", feeTypeId: "fee-a", requestId: "request-version-changed", expectedRevision: 1 } })).rejects.toMatchObject({ status: 409 });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { action: "validate-draft", feeTypeId: "fee-a" } })).rejects.toMatchObject({ status: 409 });
  });
  it("refuse une version dont la classe, l'option ou la devise a changé à tarif identique", async () => {
    for (const change of [{ className: "5ème Primaire" }, { classOptionKey: "6ème Primaire::option::B" }]) {
      const db = fakeDb();
      await manageFeeAllocationPhase1({ db, caller, body: draft });
      db.records.set("feeTypes/fee-a", { ...db.records.get("feeTypes/fee-a"), ...change });
      await expect(manageFeeAllocationPhase1({ db, caller, body: { action: "validate-draft", feeTypeId: "fee-a" } })).rejects.toMatchObject({ status: 409 });
      await expect(manageFeeAllocationPhase1({ db, caller, body: { action: "prepare-version", feeTypeId: "fee-a", requestId: "request-version-target", expectedRevision: 1 } })).rejects.toMatchObject({ status: 409 });
      expect([...db.records.keys()].filter((key) => key.startsWith("feeAllocationVersions/"))).toHaveLength(0);
    }
    const db = fakeDb();
    await manageFeeAllocationPhase1({ db, caller, body: draft });
    db.records.set("schoolYears/year-a", { ...db.records.get("schoolYears/year-a"), currency: "USD" });
    await expect(manageFeeAllocationPhase1({ db, caller, body: { action: "prepare-version", feeTypeId: "fee-a", requestId: "request-version-currency", expectedRevision: 1 } })).rejects.toMatchObject({ status: 409 });
  });
  it("confirme idempotemment une demande déjà réussie après changement d'année, sans nouvelle écriture", async () => {
    const db = fakeDb();
    await manageFeeAllocationPhase1({ db, caller, body: draft });
    const count = db.records.size;
    db.records.set("schools/school-a", { ...db.records.get("schools/school-a"), activeSchoolYearId: "year-b" });
    expect((await manageFeeAllocationPhase1({ db, caller, body: draft })).idempotent).toBe(true);
    expect(db.records.size).toBe(count);
    await expect(manageFeeAllocationPhase1({ db, caller, body: { ...draft, feeTypeId: "foreign" } })).rejects.toMatchObject({ status: 409 });
  });
});
