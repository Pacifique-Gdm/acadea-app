import { describe, expect, it } from "vitest";
import { addFeeKind, saveFeeTypes } from "./feeTypeMutations.js";

function fakeDb() {
  const records = new Map<string, Record<string, unknown>>([
    ["schools/school-a", { status: "active", activeSchoolYearId: "year-a" }],
    ["schoolYears/year-a", { schoolId: "school-a", status: "active" }],
    ["users/admin-a", { schoolId: "school-a", role: "school_admin", status: "active" }],
  ]);
  let failAudit = false;
  const db = {
    records,
    set failAudit(value: boolean) { failAudit = value; },
    doc: (path: string) => ({ path }),
    collection: (name: string) => ({ where: (field: string, _operator: string, value: unknown) => ({ where: (otherField: string, _otherOperator: string, otherValue: unknown) => ({ collection: name, filters: [[field, value], [otherField, otherValue]] }) }) }),
    runTransaction: async (work: (transaction: Record<string, unknown>) => Promise<unknown>) => {
      const writes: Array<{ action: string; path: string; value?: Record<string, unknown> }> = [];
      const transaction = {
        get: async (ref: { path?: string; collection?: string; filters?: [string, unknown][] }) => ref.collection
          ? { docs: [...records.entries()].filter(([path, value]) => path.startsWith(`${ref.collection}/`) && ref.filters?.every(([key, expected]) => value[key] === expected)).map(([path, value]) => ({ id: path.split("/")[1], data: () => value })) }
          : { exists: records.has(ref.path ?? ""), data: () => records.get(ref.path ?? "") },
        create: (ref: { path: string }, value: Record<string, unknown>) => writes.push({ action: "create", path: ref.path, value }),
        update: (ref: { path: string }, value: Record<string, unknown>) => writes.push({ action: "update", path: ref.path, value }),
        set: (ref: { path: string }, value: Record<string, unknown>) => writes.push({ action: "set", path: ref.path, value }),
        delete: (ref: { path: string }) => writes.push({ action: "delete", path: ref.path }),
      };
      const result = await work(transaction);
      if (failAudit && writes.some((write) => write.path.startsWith("auditLogs/"))) throw new Error("audit unavailable");
      for (const write of writes) if (write.action === "create" && records.has(write.path)) throw new Error("already exists");
      for (const write of writes) {
        if (write.action === "delete") records.delete(write.path);
        else records.set(write.path, write.action === "update" ? { ...records.get(write.path), ...write.value } : write.value ?? {});
      }
      return result;
    },
  };
  return db;
}

const caller = { uid: "admin-a", role: "school_admin", schoolId: "school-a", name: "Admin E2E" };
const body = { schoolYearId: "year-a", requestId: "request-1234567890", fees: [{ id: "fee-1234567890", name: "Minerval", amount: 1250000, className: "6ème Primaire" }] };

describe("enregistrement transactionnel des types de frais", () => {
  it("préserve le montant et la cible d'un frais utilisé par une décision sociale", async () => {
    const db = fakeDb();
    await saveFeeTypes({ db, caller, body });
    db.records.set("socialSupportFeeLocks/fee-1234567890", { schoolId: "school-a", schoolYearId: "year-a" });
    const edit = { ...body, editingFeeId: body.fees[0].id, requestId: "locked-edit-123456", fees: [{ ...body.fees[0], amount: 100 }] };
    await expect(saveFeeTypes({ db, caller, body: edit })).rejects.toMatchObject({ status: 409 });
    expect(db.records.get("feeTypes/fee-1234567890")?.amount).toBe(1250000);
    await expect(saveFeeTypes({ db, caller, body: { ...edit, fees: [{ ...body.fees[0], className: "5ème Primaire" }] } })).rejects.toMatchObject({ status: 409 });
    await expect(saveFeeTypes({ db, caller, body: { ...edit, fees: [{ ...body.fees[0], name: "Libellé corrigé" }] } })).resolves.toMatchObject({ idempotent: false });
  });
  it("accepte sans la renommer une classe historique réellement utilisée par cette école et cette année", async () => {
    const db = fakeDb();
    db.records.set("students/legacy", { schoolId: "school-a", schoolYearId: "year-a", className: "1ère Sciences" });
    const result = await saveFeeTypes({ db, caller, body: { ...body, fees: [{ ...body.fees[0], className: "1ère Sciences" }] } });
    expect(result.fees[0].className).toBe("1ère Sciences");
  });
  it("crée le frais et l'audit ensemble, puis confirme le même résultat après une réponse perdue", async () => {
    const db = fakeDb();
    const first = await saveFeeTypes({ db, caller, body });
    const second = await saveFeeTypes({ db, caller, body });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.fees).toEqual(first.fees);
    expect(db.records.get("feeTypes/fee-1234567890")?.amount).toBe(1250000);
    expect([...db.records.keys()].filter((path) => path.startsWith("feeTypes/"))).toHaveLength(1);
    expect([...db.records.keys()].filter((path) => path.startsWith("auditLogs/"))).toHaveLength(1);
  });

  it("n'enregistre aucun frais si l'audit ne peut pas être écrit", async () => {
    const db = fakeDb(); db.failAudit = true;
    await expect(saveFeeTypes({ db, caller, body })).rejects.toThrow("audit unavailable");
    expect([...db.records.keys()].filter((path) => path.startsWith("feeTypes/"))).toHaveLength(0);
  });

  it("refuse un autre contenu avec la même clé et un doublon avec une autre clé", async () => {
    const db = fakeDb();
    await saveFeeTypes({ db, caller, body });
    await expect(saveFeeTypes({ db, caller, body: { ...body, fees: [{ ...body.fees[0], amount: 300 }] } })).rejects.toMatchObject({ status: 409 });
    await expect(saveFeeTypes({ db, caller, body: { ...body, requestId: "request-9876543210", fees: [{ ...body.fees[0], id: "fee-9876543210" }] } })).rejects.toMatchObject({ status: 409 });
    expect(db.records.get("feeTypes/fee-1234567890")?.amount).toBe(1250000);
  });

  it("refuse les accès interétablissement, comptes inactifs et classes invalides", async () => {
    const db = fakeDb();
    await expect(saveFeeTypes({ db, caller: { ...caller, schoolId: "school-b" }, body })).rejects.toMatchObject({ status: 403 });
    db.records.set("users/admin-a", { schoolId: "school-a", role: "school_admin", status: "inactive" });
    await expect(saveFeeTypes({ db, caller, body })).rejects.toMatchObject({ status: 403 });
    db.records.set("users/admin-a", { schoolId: "school-a", role: "school_admin", status: "active" });
    await expect(saveFeeTypes({ db, caller, body: { ...body, fees: [{ ...body.fees[0], className: "Classe étrangère" }] } })).rejects.toMatchObject({ status: 400 });
  });

  it("refuse une classe historique d'une autre école ou d'une année archivée", async () => {
    const db = fakeDb();
    db.records.set("students/foreign", { schoolId: "school-b", schoolYearId: "year-a", className: "1ère Sciences" });
    db.records.set("students/old", { schoolId: "school-a", schoolYearId: "old-year", className: "1ère Sciences" });
    await expect(saveFeeTypes({ db, caller, body: { ...body, fees: [{ ...body.fees[0], className: "1ère Sciences" }] } })).rejects.toMatchObject({ status: 400 });
    expect(db.records.has("feeTypes/fee-1234567890")).toBe(false);
  });

  it("enregistre plus de 30 cibles légitimes en une seule transaction bornée", async () => {
    const db = fakeDb();
    const fees = Array.from({ length: 31 }, (_, i) => ({ ...body.fees[0], id: `fee-many-${i}`, className: "1ère Humanité", classOptionKey: `1ère Humanité::option::Option ${i}` }));
    expect((await saveFeeTypes({ db, caller, body: { ...body, fees } })).fees).toHaveLength(31);
  });
});

describe("libellé de frais d'une école coordonnée", () => {
  const request = { action: "add-fee-kind", schoolYearId: "year-a", requestId: "kind-request-12345", name: "Frais fictif" };
  it("ne modifie que la liste, garde les métadonnées et confirme les réessais sans doublon", async () => {
    const db = fakeDb();
    db.records.set("schools/school-a", { status: "active", activeSchoolYearId: "year-a", activeCoordinationId: "coord-a" });
    db.records.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF", startsAt: "2027-09-01" });
    expect((await addFeeKind({ db, caller, body: request })).idempotent).toBe(false);
    expect((await addFeeKind({ db, caller, body: request })).idempotent).toBe(true);
    expect((await addFeeKind({ db, caller, body: { ...request, requestId: "kind-request-other", name: " FRAIS FICTIF " } })).idempotent).toBe(true);
    expect(db.records.get("schoolYears/year-a")).toEqual({ schoolId: "school-a", status: "active", currency: "CDF", startsAt: "2027-09-01", customFeeKindChoices: ["Frais fictif"] });
    expect([...db.records.keys()].filter(k => k.startsWith("auditLogs/"))).toHaveLength(1);
    expect([...db.records.keys()].filter(k => k.startsWith("feeTypes/"))).toHaveLength(0);
  });
  it("refuse l'usurpation de demande, les champs interdits et les accès non autorisés", async () => {
    const db = fakeDb();
    await addFeeKind({ db, caller, body: request });
    await expect(addFeeKind({ db, caller, body: { ...request, name: "Autre nom" } })).rejects.toMatchObject({ status: 409 });
    await expect(addFeeKind({ db, caller, body: { ...request, currency: "USD" } })).rejects.toMatchObject({ status: 400 });
    await expect(addFeeKind({ db, caller: { ...caller, role: "teacher" }, body: request })).rejects.toMatchObject({ status: 403 });
    await expect(addFeeKind({ db, caller: { ...caller, schoolId: "school-b" }, body: request })).rejects.toMatchObject({ status: 403 });
    db.records.set("schoolYears/year-a", { schoolId: "school-a", status: "archived" });
    await expect(addFeeKind({ db, caller, body: request })).rejects.toMatchObject({ status: 409 });
  });
  it("ne laisse aucun libellé ni reçu si l'audit échoue", async () => {
    const db = fakeDb(); db.failAudit = true;
    await expect(addFeeKind({ db, caller, body: request })).rejects.toThrow("audit unavailable");
    expect(db.records.get("schoolYears/year-a")?.customFeeKindChoices).toBeUndefined();
    expect([...db.records.keys()].some(k => k.startsWith("feeKindRequests/"))).toBe(false);
  });
});
