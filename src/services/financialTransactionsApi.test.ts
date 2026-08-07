import { describe, expect, it } from "vitest";
import { executeFinancialOperation, FinancialApiError } from "../../api/_lib/financialTransactions.js";

type StoredDocument = Record<string, unknown>;
type Reference = { path: string };
type Query = { collectionName: string; filters: Array<[string, unknown]>; where(field: string, operator: string, value: unknown): Query };

function fakeDb(seed: Record<string, StoredDocument>) {
  const documents = new Map(Object.entries(seed));
  let queue = Promise.resolve();
  const db = {
    documents,
    doc(path: string): Reference { return { path }; },
    collection(collectionName: string): Query {
      const query: Query = {
        collectionName,
        filters: [],
        where(field, _operator, value) { this.filters.push([field, value]); return this; },
      };
      return query;
    },
    runTransaction<T>(operation: (transaction: {
      get(target: Reference | Query): Promise<unknown>;
      set(reference: Reference, value: StoredDocument, options?: { merge?: boolean }): void;
      create(reference: Reference, value: StoredDocument): void;
      update(reference: Reference, value: StoredDocument): void;
      delete(reference: Reference): void;
    }) => Promise<T>) {
      const run = queue.then(async () => {
        const pending: Array<() => void> = [];
        const transaction = {
          async get(target: Reference | Query) {
            if ("path" in target) {
              const value = documents.get(target.path);
              return { exists: Boolean(value), data: () => value };
            }
            const prefix = `${target.collectionName}/`;
            const docs = [...documents.entries()]
              .filter(([path, value]) => path.startsWith(prefix) && target.filters.every(([field, expected]) => value[field] === expected))
              .map(([path, value]) => ({ id: path.slice(prefix.length), data: () => value }));
            return { docs, empty: docs.length === 0, size: docs.length };
          },
          set(reference: Reference, value: StoredDocument, options?: { merge?: boolean }) {
            pending.push(() => documents.set(reference.path, options?.merge ? { ...(documents.get(reference.path) ?? {}), ...value } : value));
          },
          create(reference: Reference, value: StoredDocument) {
            pending.push(() => {
              if (documents.has(reference.path)) throw new Error("already-exists");
              documents.set(reference.path, value);
            });
          },
          update(reference: Reference, value: StoredDocument) {
            pending.push(() => documents.set(reference.path, { ...(documents.get(reference.path) ?? {}), ...value }));
          },
          delete(reference: Reference) { pending.push(() => documents.delete(reference.path)); },
        };
        const result = await operation(transaction);
        pending.forEach((commit) => commit());
        return result;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return db;
}

function baseSeed() {
  return {
    "schools/school-a": { id: "school-a", status: "active" },
    "schoolYears/year-a": { id: "year-a", schoolId: "school-a", name: "2026-2027", status: "active" },
    "users/cashier-a": { id: "cashier-a", schoolId: "school-a", role: "cashier", status: "active", name: "Caissier Test" },
    "users/admin-a": { id: "admin-a", schoolId: "school-a", role: "school_admin", status: "active", name: "Admin Test" },
    "students/student-a": { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", status: "ACTIVE", parentId: "parent-a" },
    "feeTypes/fee-a": { id: "fee-a", schoolId: "school-a", schoolYearId: "year-a", amount: 1_000 },
    "students/student-b": { id: "student-b", schoolId: "school-b", schoolYearId: "year-b", status: "ACTIVE" },
    "feeTypes/fee-b": { id: "fee-b", schoolId: "school-b", schoolYearId: "year-b", amount: 1_000 },
  };
}

const cashier = { uid: "cashier-a", role: "cashier", schoolId: "school-a", email: "cashier@example.invalid" };
const admin = { uid: "admin-a", role: "school_admin", schoolId: "school-a", email: "admin@example.invalid" };
const paymentBody = (clientRequestId: string) => ({ action: "create-payment", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 25, clientRequestId });

describe("API financière transactionnelle", () => {
  it("impose le tenant, la provenance et les horodatages depuis le serveur", async () => {
    const db = fakeDb(baseSeed());
    const result = await executeFinancialOperation({ db, caller: cashier, body: paymentBody("request-payment-001"), now: "2026-08-07T12:00:00.000Z" });
    expect(result.payment).toMatchObject({ schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 25, createdBy: "cashier-a", updatedBy: "cashier-a", createdAt: "2026-08-07T12:00:00.000Z", provenance: "financial-api", receiptNumber: "REC-2026-0001" });
  });

  it("refuse les identifiants d'une autre école et les montants non positifs", async () => {
    const db = fakeDb(baseSeed());
    await expect(executeFinancialOperation({ db, caller: cashier, body: { ...paymentBody("request-payment-002"), studentId: "student-b" } })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(executeFinancialOperation({ db, caller: cashier, body: { ...paymentBody("request-payment-003"), feeTypeId: "fee-b" } })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(executeFinancialOperation({ db, caller: cashier, body: { ...paymentBody("request-payment-004"), amount: 0 } })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(executeFinancialOperation({ db, caller: cashier, body: { ...paymentBody("request-payment-tenant"), schoolId: "school-b" } })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("refuse un rôle inconnu, un Admin pour la création et un Caissier pour la correction", async () => {
    const db = fakeDb(baseSeed());
    await expect(executeFinancialOperation({ db, caller: { ...cashier, role: "teacher" }, body: paymentBody("request-payment-005") })).rejects.toBeInstanceOf(FinancialApiError);
    await expect(executeFinancialOperation({ db, caller: admin, body: paymentBody("request-payment-006") })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(executeFinancialOperation({ db, caller: cashier, body: { action: "update-payment", transactionId: "payment-a", amount: 10, reason: "Correction", clientRequestId: "request-payment-007" } })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("est idempotente lorsque la même requête est envoyée deux fois", async () => {
    const db = fakeDb(baseSeed());
    const [first, second] = await Promise.all([
      executeFinancialOperation({ db, caller: cashier, body: paymentBody("request-payment-same") }),
      executeFinancialOperation({ db, caller: cashier, body: paymentBody("request-payment-same") }),
    ]);
    expect(first.payment?.id).toBe(second.payment?.id);
    expect([...db.documents.keys()].filter((path) => path.startsWith("payments/")).length).toBe(1);
  });

  it("génère des numéros de reçu uniques en concurrence et initialise après l'historique", async () => {
    const db = fakeDb({ ...baseSeed(), "payments/legacy": { id: "legacy", schoolId: "school-a", schoolYearId: "year-a", studentId: "other", feeTypeId: "other", amount: 1, receiptNumber: "REC-2026-0042" } });
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => executeFinancialOperation({ db, caller: cashier, body: paymentBody(`concurrent-payment-${index}`) })));
    const receipts = results.map((result) => result.payment?.receiptNumber);
    expect(new Set(receipts).size).toBe(5);
    expect(receipts).toEqual(["REC-2026-0043", "REC-2026-0044", "REC-2026-0045", "REC-2026-0046", "REC-2026-0047"]);
    expect(db.documents.get("financialCounters/school-a_year-a_receipt")?.lastReceiptNumber).toBe(47);
  });

  it("crée une dépense validée puis réserve les corrections à l'Administrateur", async () => {
    const db = fakeDb(baseSeed());
    const created = await executeFinancialOperation({ db, caller: cashier, body: { action: "create-expense", schoolYearId: "year-a", amount: 50, category: "Fournitures", description: "Papier", beneficiary: "Fournisseur", paymentMethod: "Espèces", reference: "REF-1", clientRequestId: "request-expense-001" } });
    expect(created.expense).toMatchObject({ schoolId: "school-a", createdBy: "cashier-a", amount: 50, provenance: "financial-api" });
    if (!created.expense) throw new Error("Dépense de test absente.");
    const updated = await executeFinancialOperation({ db, caller: admin, body: { action: "update-expense", transactionId: created.expense.id, amount: 45, category: "Fournitures", description: "Papier corrigé", reason: "Erreur de saisie", clientRequestId: "request-expense-002" } });
    expect(updated.expense).toMatchObject({ amount: 45, updatedBy: "admin-a", correctionReason: "Erreur de saisie" });
  });
});
