import { describe, expect, it } from "vitest";
import { authorizeFinancialCaller, executeFinancialOperation } from "./financialTransactions.js";

const caller = { uid: "section-a", role: "primary_admin", schoolId: "school-a" };
const updateBody = { action: "update-payment", transactionId: "payment-a", amount: 12,
  reason: "Correction vérifiée", confirmation: "MODIFIER CE PAIEMENT", expectedUpdatedAt: "2026-10-31T12:00:00.000Z", clientRequestId: "section-payment-0001" };

function fixture(section = "Primaire") {
  const values = new Map<string, Record<string, unknown>>([
    ["schools/school-a", { status: "active", currency: "CDF", activeSchoolYearId: "year-a" }],
    ["schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF" }],
    ["users/section-a", { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Primaire"] }],
    ["students/student-a", { schoolId: "school-a", schoolYearId: "year-a", status: "ACTIVE", section }],
    ["feeTypes/fee-a", { schoolId: "school-a", schoolYearId: "year-a", amount: 50 }],
    ["payments/payment-a", { id: "payment-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a",
      feeTypeId: "fee-a", amount: 10, currency: "CDF", updatedAt: "2026-10-31T12:00:00.000Z" }],
  ]);
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: values.has(path), data: () => values.get(path) });
  const query = (name: string, filters: Array<[string, unknown]> = []): { where: (field: string, operator: string, value: unknown) => ReturnType<typeof query>; get: () => Promise<{ docs: Array<{ id: string | undefined; data: () => Record<string, unknown> | undefined }> }> } => ({
    where: (field, _operator, value) => query(name, [...filters, [field, value]]),
    get: async () => ({ docs: [...values].filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value))
      .map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data })) }),
  });
  const db = {
    doc: (path: string) => ({ path }),
    collection: (name: string) => query(name),
    runTransaction: async (operation: (transaction: {
      get: (ref: { path: string } | ReturnType<typeof query>) => Promise<unknown>;
      set: (ref: { path: string }, value: Record<string, unknown>) => void;
      update: (ref: { path: string }, value: Record<string, unknown>) => void;
      delete: (ref: { path: string }) => void;
      create: (ref: { path: string }, value: Record<string, unknown>) => void;
    }) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const result = await operation({
        get: async (ref) => "path" in ref ? snapshot(ref.path) : ref.get(),
        set: (ref, value) => writes.push(() => values.set(ref.path, value)),
        update: (ref, value) => writes.push(() => values.set(ref.path, { ...values.get(ref.path), ...value })),
        delete: (ref) => writes.push(() => values.delete(ref.path)),
        create: (ref, value) => writes.push(() => values.set(ref.path, value)),
      });
      writes.forEach((write) => write());
      return result;
    },
  };
  return { db, values };
}

describe("corrections de paiements du profil administratif de section", () => {
  it("ne lui accorde ni dépense, ni entrée de caisse non attribuée", () => {
    for (const action of ["create-expense", "create-cash-inflow", "update-expense", "delete-expense"]) {
      expect(() => authorizeFinancialCaller(caller, action)).toThrow();
    }
  });

  it("crée un encaissement seulement pour un élève de sa section, sans écraser ni doubler un paiement", async () => {
    const state = fixture();
    const body = { action: "create-payment", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a",
      amount: 12, clientRequestId: "section-create-0001" };
    await expect(executeFinancialOperation({ db: state.db, caller, body }))
      .resolves.toMatchObject({ idempotent: false, section: "Primaire", payment: { section: "Primaire", amount: 12 } });
    expect([...state.values.entries()].filter(([path]) => path.startsWith("payments/"))).toHaveLength(2);
    await expect(executeFinancialOperation({ db: state.db, caller, body }))
      .resolves.toMatchObject({ idempotent: true, section: "Primaire" });
    expect([...state.values.entries()].filter(([path]) => path.startsWith("payments/"))).toHaveLength(2);
    state.values.set("users/section-a", { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Secondaire"] });
    await expect(executeFinancialOperation({ db: state.db, caller, body }))
      .rejects.toMatchObject({ status: 403, code: "permission-denied" });
  });

  it("refuse la création pour un élève d'une autre section avant toute écriture", async () => {
    const state = fixture("Secondaire");
    const body = { action: "create-payment", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a",
      amount: 12, clientRequestId: "section-create-0002" };
    await expect(executeFinancialOperation({ db: state.db, caller, body }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    expect([...state.values.keys()].filter((path) => path.startsWith("payments/"))).toEqual(["payments/payment-a"]);
    expect([...state.values.keys()].some((path) => path.startsWith("financialIdempotency/"))).toBe(false);
  });

  it("refuse une autre section avant toute écriture", async () => {
    const state = fixture("Secondaire");
    await expect(executeFinancialOperation({ db: state.db, caller, body: updateBody }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    expect(state.values.get("payments/payment-a")?.amount).toBe(10);
    expect([...state.values.keys()].some((path) => path.startsWith("financialIdempotency/"))).toBe(false);
  });

  it("corrige uniquement le paiement lié à la section et protège la relance idempotente", async () => {
    const state = fixture();
    await expect(executeFinancialOperation({ db: state.db, caller, body: updateBody }))
      .resolves.toMatchObject({ idempotent: false, section: "Primaire", payment: { amount: 12 } });
    expect(state.values.get("payments/payment-a")?.amount).toBe(12);
    await expect(executeFinancialOperation({ db: state.db, caller, body: updateBody }))
      .resolves.toMatchObject({ idempotent: true, section: "Primaire" });
    state.values.set("users/section-a", { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Secondaire"] });
    await expect(executeFinancialOperation({ db: state.db, caller, body: updateBody }))
      .rejects.toMatchObject({ status: 403, code: "permission-denied" });
  });

  it("refuse un paiement historique dont l'élève actuel sort de la section", async () => {
    const state = fixture();
    state.values.set("students/current-a", { schoolId: "school-a", schoolYearId: "year-a", section: "Secondaire" });
    state.values.set("payments/payment-a", { ...state.values.get("payments/payment-a"), currentStudentId: "current-a", collectionSchoolYearId: "year-a" });
    await expect(executeFinancialOperation({ db: state.db, caller, body: updateBody }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    expect(state.values.get("payments/payment-a")?.amount).toBe(10);
  });

  it("supprime un paiement de sa section sans supprimer une écriture étrangère", async () => {
    const state = fixture();
    const deleteBody = { action: "delete-payment", transactionId: "payment-a", reason: "Annulation vérifiée", clientRequestId: "section-delete-0001" };
    await expect(executeFinancialOperation({ db: state.db, caller, body: deleteBody }))
      .resolves.toMatchObject({ deletedId: "payment-a", section: "Primaire", idempotent: false });
    expect(state.values.has("payments/payment-a")).toBe(false);
    await expect(executeFinancialOperation({ db: state.db, caller, body: deleteBody }))
      .resolves.toMatchObject({ deletedId: "payment-a", section: "Primaire", idempotent: true });
    const foreign = fixture("Secondaire");
    await expect(executeFinancialOperation({ db: foreign.db, caller, body: deleteBody }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    expect(foreign.values.has("payments/payment-a")).toBe(true);
  });
});
