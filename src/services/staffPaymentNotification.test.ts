import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeFinancialOperation } from "../../api/_lib/financialTransactions.js";

// Lot 4 : la notification « Paiement enregistré » part aussi vers le membre du personnel désigné
// par la décision de prise en charge active (motif « Personnel de l'école »), avec le même texte.
// Base en mémoire recopiée de financialTransactionsApi.test.ts, avec une règle de plus :
// comme dans Firestore, une lecture après une écriture fait échouer la transaction.
type StoredDocument = Record<string, unknown>;
type Reference = { path: string };
type Query = { collectionName: string; filters: Array<[string, unknown, string?]>; where(field: string, operator: string, value: unknown): Query };

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
        where(field, operator, value) { this.filters.push([field, value, operator]); return this; },
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
        let wrote = false;
        const transaction = {
          async get(target: Reference | Query) {
            if (wrote) throw new Error("lecture après écriture");
            if ("path" in target) {
              const value = documents.get(target.path);
              return { exists: Boolean(value), data: () => value };
            }
            const prefix = `${target.collectionName}/`;
            const docs = [...documents.entries()]
              .filter(([path, value]) => path.startsWith(prefix) && target.filters.every(([field, expected, operator]) => operator === "in" ? (expected as unknown[]).includes(value[field]) : value[field] === expected))
              .map(([path, value]) => ({ id: path.slice(prefix.length), data: () => value }));
            return { docs, empty: docs.length === 0, size: docs.length };
          },
          set(reference: Reference, value: StoredDocument, options?: { merge?: boolean }) {
            wrote = true;
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

function seed(extra: Record<string, StoredDocument> = {}) {
  return {
    "schools/school-a": { id: "school-a", status: "active", activeSchoolYearId: "year-a" },
    "schoolYears/year-a": { id: "year-a", schoolId: "school-a", name: "2026-2027", status: "active" },
    "users/cashier-a": { id: "cashier-a", schoolId: "school-a", role: "cashier", status: "active", name: "Caissier Test" },
    "students/student-a": { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", status: "ACTIVE", parentId: "parent-a", nom: "KABEYA", prenom: "Grâce" },
    "feeTypes/fee-a": { id: "fee-a", schoolId: "school-a", schoolYearId: "year-a", amount: 1_000, name: "Minerval" },
    ...extra,
  };
}
const decision = (values: StoredDocument = {}) => ({ schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", reason: "personnel", personnelId: "teacher-a", status: "active", nature: "percent", lines: {}, ...values });
const cashier = { uid: "cashier-a", role: "cashier", schoolId: "school-a", email: "cashier@example.invalid" };
const pay = (db: ReturnType<typeof fakeDb>, id: string) => executeFinancialOperation({ db, caller: cashier, body: { action: "create-payment", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 25, clientRequestId: id }, now: "2026-10-10T09:00:00.000Z" });
const notifications = (db: ReturnType<typeof fakeDb>) => [...db.documents.entries()].filter(([path]) => path.startsWith("notifications/")).map(([, value]) => value as Record<string, unknown>);

describe("lot 4 : notification de paiement au personnel", () => {
  it("le parent ET le membre du personnel désigné reçoivent « Paiement enregistré », avec le même texte", async () => {
    const db = fakeDb(seed({ "socialSupportDecisions/d1": decision() }));
    await pay(db, "staff-notification-001");
    const all = notifications(db);
    const parent = all.find((item) => item.parentId === "parent-a");
    const staff = all.find((item) => item.recipientUserId === "teacher-a");
    expect(all).toHaveLength(2);
    expect(parent).toMatchObject({ recipientRole: "parent", event: "payment_recorded", title: "Paiement enregistré" });
    expect(staff).toMatchObject({ type: "payment", event: "payment_recorded", title: "Paiement enregistré", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", read: false });
    expect(staff?.body).toBe(parent?.body);
    expect(staff?.body).toContain("Élève : KABEYA Grâce");
    // Notification personnelle : ni parentId, ni destinataire « parent » ou « école ».
    expect(staff).not.toHaveProperty("parentId");
    expect(staff).not.toHaveProperty("recipientRole");
  });

  it("sans décision « Personnel de l'école » active de l'année, seul le parent est notifié (comme avant)", async () => {
    const cases: Array<Record<string, StoredDocument>> = [
      {},
      { "socialSupportDecisions/d1": decision({ status: "cancelled" }) },
      { "socialSupportDecisions/d1": decision({ schoolYearId: "ancienne-annee" }) },
      { "socialSupportDecisions/d1": decision({ schoolId: "school-b" }) },
      { "socialSupportDecisions/d1": decision({ reason: "orphan", personnelId: null }) },
    ];
    for (const [index, extra] of cases.entries()) {
      const db = fakeDb(seed(extra));
      await pay(db, `staff-notification-none-${index}`);
      const all = notifications(db);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ parentId: "parent-a", recipientRole: "parent" });
    }
  });

  it("élève sans parent lié : le membre du personnel est quand même notifié", async () => {
    const db = fakeDb(seed({ "students/student-a": { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", status: "ACTIVE", nom: "KABEYA" }, "socialSupportDecisions/d1": decision() }));
    await pay(db, "staff-notification-no-parent");
    expect(notifications(db)).toEqual([expect.objectContaining({ recipientUserId: "teacher-a", event: "payment_recorded" })]);
  });

  it("la décision est lue avant toute écriture, et un nouvel envoi de la même demande ne double rien", async () => {
    const db = fakeDb(seed({ "socialSupportDecisions/d1": decision() }));
    await pay(db, "staff-notification-repeat");
    await pay(db, "staff-notification-repeat");
    expect(notifications(db)).toHaveLength(2);
    const source = readFileSync("api/_lib/financialTransactions.js", "utf8");
    expect(source.indexOf("const staffRecipientIds")).toBeLessThan(source.indexOf("transaction.set(db.doc(`payments/${paymentId}`), payment);"));
  });
});
