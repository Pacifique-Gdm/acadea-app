import { describe, expect, it } from "vitest";
import { executeFinancialOperation, FinancialApiError, listStudentArrears, listScopedStudentArrears } from "../../api/_lib/financialTransactions.js";

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
  function historicalSeed() {
    return {
      ...baseSeed(),
      "schools/school-a": { id: "school-a", status: "active", activeSchoolYearId: "year-current", currency: "CDF" },
      "schoolYears/year-a": { id: "year-a", schoolId: "school-a", name: "2026-2027", status: "archived", startsAt: "2026-09-01", currency: "CDF" },
      "schoolYears/year-current": { id: "year-current", schoolId: "school-a", name: "2027-2028", status: "active", startsAt: "2027-09-01", currency: "CDF" },
      "students/student-a": { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", status: "ACTIVE", matricule: "ACD-26-0001", className: "6ème Primaire", nom: "Élève" },
      "students/student-current": { id: "student-current", schoolId: "school-a", schoolYearId: "year-current", status: "ACTIVE", matricule: "ACD-26-0001", importedFromStudentId: "student-a", className: "7ème CTEB", nom: "Élève" },
      "feeTypes/fee-a": { id: "fee-a", schoolId: "school-a", schoolYearId: "year-a", name: "Minerval", amount: 100, className: "6ème Primaire" },
      "feeTypes/fee-current": { id: "fee-current", schoolId: "school-a", schoolYearId: "year-current", name: "Minerval", amount: 200, className: "7ème CTEB" },
      "payments/payment-existing": { id: "payment-existing", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 70 },
    };
  }

  it("permet de solder partiellement une créance archivée depuis l'année active sans altérer le frais actuel", async () => {
    const db = fakeDb(historicalSeed());
    const result = await executeFinancialOperation({ db, caller: cashier, body: {
      action: "create-payment", schoolYearId: "year-current", studentId: "student-current", debtSchoolYearId: "year-a", feeTypeId: "fee-a", amount: 20, clientRequestId: "historical-payment-001",
    }, now: "2027-10-01T12:00:00.000Z" });
    expect(result.payment).toMatchObject({ schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", collectionSchoolYearId: "year-current", currentStudentId: "student-current", amount: 20, paidAt: "2027-10-01" });
    expect(db.documents.get("feeTypes/fee-current")?.amount).toBe(200);
    expect(db.documents.get("payments/payment-existing")?.amount).toBe(70);
  });

  it("partage exactement le calcul canonique des arriérés avec la supervision sans aucune écriture", async () => {
    const db = fakeDb(historicalSeed());
    const before = [...db.documents];
    const canonical = await listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } });
    expect(await listScopedStudentArrears({ db, studentId: "student-current", schoolIds: ["school-a"] })).toEqual(canonical);
    expect([...db.documents]).toEqual(before);
  });

  it("refuse les arriérés hors périmètre ou dans un contexte scolaire incohérent", async () => {
    const db = fakeDb(historicalSeed());
    await expect(listScopedStudentArrears({ db, studentId: "student-current", schoolIds: ["school-b"] })).rejects.toMatchObject({ status: 404 });
    await expect(listScopedStudentArrears({ db, studentId: "student-current", schoolIds: [] })).rejects.toMatchObject({ status: 404 });
    db.documents.set("schoolYears/year-current", { schoolId: "school-b" });
    await expect(listScopedStudentArrears({ db, studentId: "student-current", schoolIds: ["school-a"] })).rejects.toMatchObject({ status: 409 });
    expect(db.documents.get("payments/payment-existing")?.amount).toBe(70);
  });

  it("refuse une créance d'un autre élève ou d'une autre école", async () => {
    const db = fakeDb({ ...historicalSeed(),
      "students/other-historical": { id: "other-historical", schoolId: "school-a", schoolYearId: "year-a", status: "ACTIVE", matricule: "OTHER", className: "6ème Primaire" },
      "feeTypes/other-fee": { id: "other-fee", schoolId: "school-b", schoolYearId: "year-a", amount: 100 },
    });
    await expect(executeFinancialOperation({ db, caller: cashier, body: { action: "create-payment", schoolYearId: "year-current", studentId: "student-current", debtSchoolYearId: "year-a", feeTypeId: "other-fee", amount: 20, clientRequestId: "historical-payment-002" } })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(executeFinancialOperation({ db, caller: { ...cashier, role: "teacher" }, body: { action: "create-payment", schoolYearId: "year-current", studentId: "student-current", debtSchoolYearId: "year-a", feeTypeId: "fee-a", amount: 20, clientRequestId: "historical-payment-003" } })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("liste les arriérés par frais et année, exclut les créances soldées et garde leur historique", async () => {
    const db = fakeDb({ ...historicalSeed(),
      "schoolYears/year-older": { id: "year-older", schoolId: "school-a", name: "2025-2026", status: "archived", startsAt: "2025-09-01", currency: "CDF" },
      "students/student-older": { id: "student-older", schoolId: "school-a", schoolYearId: "year-older", status: "ACTIVE", matricule: "ACD-26-0001", className: "5ème Primaire", nom: "Élève" },
      "feeTypes/fee-older": { id: "fee-older", schoolId: "school-a", schoolYearId: "year-older", name: "Minerval", amount: 50, className: "5ème Primaire" },
      "feeTypes/fee-school": { id: "fee-school", schoolId: "school-a", schoolYearId: "year-a", name: "Frais scolaires", amount: 80, className: "6ème Primaire" },
      "feeTypes/fee-settled": { id: "fee-settled", schoolId: "school-a", schoolYearId: "year-a", name: "Transport", amount: 40, className: "6ème Primaire" },
      "payments/payment-settled": { id: "payment-settled", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-settled", amount: 40 },
    });
    const result = await listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } });
    expect(result.debts.map((debt) => [debt.yearName, debt.feeName, debt.remaining])).toEqual([
      ["2025-2026", "Minerval", 50], ["2026-2027", "Frais scolaires", 80], ["2026-2027", "Minerval", 30],
    ]);
    expect(result.settled).toMatchObject([{ yearName: "2026-2027", feeName: "Transport", remaining: 0 }]);
  });

  it("autorise le parent lié à lire uniquement les arriérés de son enfant actif dans son école", async () => {
    const seed = historicalSeed();
    const db = fakeDb({ ...seed,
      "users/parent-a": { id: "parent-a", schoolId: "school-a", role: "parent", parentId: "parent-profile-a", status: "active" },
      "students/student-current": { ...seed["students/student-current"], parentId: "parent-profile-a" },
      "students/unrelated": { id: "unrelated", schoolId: "school-a", schoolYearId: "year-current", status: "ACTIVE", parentId: "parent-profile-b" },
      "students/foreign": { id: "foreign", schoolId: "school-b", schoolYearId: "year-current", status: "ACTIVE", parentId: "parent-profile-a" },
    });
    const parent = { uid: "parent-a", role: "parent", schoolId: "school-a", parentId: "parent-profile-a" };
    const body = { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" };
    await expect(listStudentArrears({ db, caller: parent, body })).resolves.toMatchObject({ debts: [{ feeTypeId: "fee-a", remaining: 30 }] });
    await expect(listStudentArrears({ db, caller: parent, body: { ...body, studentId: "unrelated" } })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(listStudentArrears({ db, caller: parent, body: { ...body, studentId: "foreign" } })).rejects.toMatchObject({ code: "invalid-argument" });
    const inactiveDb = fakeDb({ ...Object.fromEntries(db.documents), "users/parent-a": { schoolId: "school-a", role: "parent", parentId: "parent-profile-a", status: "inactive" } });
    await expect(listStudentArrears({ db: inactiveDb, caller: parent, body })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("recalcule les acomptes en transaction et retire la dette après solde complet", async () => {
    const db = fakeDb(historicalSeed());
    const body = { action: "create-payment", schoolYearId: "year-current", studentId: "student-current", debtSchoolYearId: "year-a", feeTypeId: "fee-a" };
    await executeFinancialOperation({ db, caller: cashier, body: { ...body, amount: 20, clientRequestId: "historical-installment-a" } });
    expect((await listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } })).debts[0]?.remaining).toBe(10);
    await expect(executeFinancialOperation({ db, caller: cashier, body: { ...body, amount: 11, clientRequestId: "historical-overpayment" } })).rejects.toMatchObject({ code: "conflict" });
    await executeFinancialOperation({ db, caller: cashier, body: { ...body, amount: 10, clientRequestId: "historical-installment-b" } });
    const result = await listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } });
    expect(result.debts).toEqual([]);
    expect(result.settled).toMatchObject([{ feeTypeId: "fee-a", paid: 100, remaining: 0 }]);
    expect([...db.documents.keys()].filter((path) => path.startsWith("payments/"))).toHaveLength(3);
  });

  it("n'attribue jamais au mauvais élève une créance ayant le même type", async () => {
    const db = fakeDb({ ...historicalSeed(),
      "students/other-current": { id: "other-current", schoolId: "school-a", schoolYearId: "year-current", status: "ACTIVE", matricule: "DIFFERENT", className: "7ème CTEB" },
    });
    await expect(executeFinancialOperation({ db, caller: cashier, body: { action: "create-payment", schoolYearId: "year-current", studentId: "other-current", debtSchoolYearId: "year-a", feeTypeId: "fee-a", amount: 20, clientRequestId: "wrong-student-debt" } })).rejects.toMatchObject({ code: "invalid-argument" });
    const result = await listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "other-current" } });
    expect(result.debts).toEqual([]);
  });

  it("refuse le profil inactif et l'année active détournée", async () => {
    const seed = historicalSeed();
    const db = fakeDb({ ...seed, "users/cashier-a": { ...seed["users/cashier-a"], status: "inactive" } });
    await expect(listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } })).rejects.toMatchObject({ code: "permission-denied" });
    const activeDb = fakeDb(seed);
    await expect(listStudentArrears({ db: activeDb, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-a", studentId: "student-a" } })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("conserve une dette d'origine quand la classe, la sous-classe et l'option actuelles changent", async () => {
    const seed = historicalSeed();
    const db = fakeDb({ ...seed,
      "students/student-a": { ...seed["students/student-a"], className: "2ème Humanité", option: "Littéraire", subClassId: "ancienne-a" },
      "students/student-current": { ...seed["students/student-current"], className: "3ème Humanité", option: "Scientifique", subClassId: "nouvelle-b" },
      "feeTypes/fee-a": { ...seed["feeTypes/fee-a"], className: "2ème Humanité", classOptionKey: "2ème Humanité::option::Littéraire" },
    });
    const listed = await listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } });
    expect(listed.debts).toMatchObject([{ feeTypeId: "fee-a", remaining: 30 }]);
  });

  it("isole deux années antérieures portant le même nom de frais et ne dépend pas du frais actuel", async () => {
    const seed = historicalSeed();
    const withoutCurrentFee = Object.fromEntries(Object.entries(seed).filter(([path]) => path !== "feeTypes/fee-current"));
    const db = fakeDb({ ...withoutCurrentFee,
      "schoolYears/year-older": { id: "year-older", schoolId: "school-a", name: "2025-2026", status: "archived", startsAt: "2025-09-01", currency: "USD" },
      "students/student-older": { id: "student-older", schoolId: "school-a", schoolYearId: "year-older", matricule: "ACD-26-0001", className: "5ème Primaire", nom: "Élève" },
      "feeTypes/fee-older": { id: "fee-older", schoolId: "school-a", schoolYearId: "year-older", name: "Minerval", amount: 60, className: "5ème Primaire" },
    });
    const listed = await listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } });
    expect(listed.debts.map((debt) => [debt.schoolYearId, debt.feeTypeId, debt.remaining, debt.currency])).toEqual([
      ["year-older", "fee-older", 60, "USD"], ["year-a", "fee-a", 30, "CDF"],
    ]);
  });

  it("refuse la lecture inter-écoles, le corps manipulé et une filiation par matricule contradictoire", async () => {
    const seed = historicalSeed();
    const db = fakeDb({ ...seed,
      "students/foreign-current": { id: "foreign-current", schoolId: "school-b", schoolYearId: "year-current", status: "ACTIVE", matricule: "ACD-26-0001" },
    });
    await expect(listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "foreign-current" } })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(listStudentArrears({ db, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current", schoolId: "school-b" } })).rejects.toMatchObject({ code: "invalid-argument" });
    const collisionDb = fakeDb({ ...seed,
      "students/student-current": { ...seed["students/student-current"], importedFromStudentId: "" },
      "students/student-a": { ...seed["students/student-a"], nom: "Une autre personne" },
    });
    const listed = await listStudentArrears({ db: collisionDb, caller: cashier, body: { action: "list-arrears", schoolYearId: "year-current", studentId: "student-current" } });
    expect(listed.debts).toEqual([]);
  });

  it("n'enregistre qu'un paiement historique idempotent sans recopier le frais dans l'année active", async () => {
    const db = fakeDb(historicalSeed());
    const body = { action: "create-payment", schoolYearId: "year-current", studentId: "student-current", debtSchoolYearId: "year-a", feeTypeId: "fee-a", amount: 20, clientRequestId: "historical-idempotent-1" };
    const first = await executeFinancialOperation({ db, caller: cashier, body });
    const second = await executeFinancialOperation({ db, caller: cashier, body });
    expect(first.payment?.id).toBe(second.payment?.id);
    expect([...db.documents.entries()].filter(([path]) => path.startsWith("payments/"))).toHaveLength(2);
    expect([...db.documents.entries()].filter(([path, fee]) => path.startsWith("feeTypes/") && fee.schoolId === "school-a")).toHaveLength(2);
    expect(db.documents.get(`financialCounters/school-a_year-current_receipt`)?.lastReceiptNumber).toBe(1);
  });
  it("impose le tenant, la provenance et les horodatages depuis le serveur", async () => {
    const db = fakeDb(baseSeed());
    const result = await executeFinancialOperation({ db, caller: cashier, body: { ...paymentBody("request-payment-001"), note: " Premier acompte " }, now: "2026-08-07T12:00:00.000Z" });
    expect(result.payment).toMatchObject({ schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 25, note: "Premier acompte", createdBy: "cashier-a", updatedBy: "cashier-a", createdAt: "2026-08-07T12:00:00.000Z", provenance: "financial-api", receiptNumber: "REC-2026-0001" });
  });

  it("résout la devise depuis l'année plutôt que depuis le fallback global de l'école", async () => {
    const db = fakeDb({
      ...baseSeed(),
      "schools/school-a": { id: "school-a", status: "active", currency: "CDF" },
      "schoolYears/year-a": { id: "year-a", schoolId: "school-a", name: "2026-2027", status: "active", currency: "USD" },
      "students/student-a": { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", status: "ACTIVE", parentId: "parent-a", nom: "Élève" },
    });
    await executeFinancialOperation({ db, caller: cashier, body: paymentBody("request-annual-currency"), now: "2026-08-07T12:00:00.000Z" });
    const notification = [...db.documents.entries()].find(([path]) => path.startsWith("notifications/"))?.[1];
    expect(notification?.body).toContain("$25.00");
  });

  it("distingue un frais soldé d'un montant supérieur au solde restant", async () => {
    const partiallyPaidDb = fakeDb({
      ...baseSeed(),
      "payments/payment-existing": { id: "payment-existing", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 980 },
    });
    await expect(executeFinancialOperation({ db: partiallyPaidDb, caller: cashier, body: { ...paymentBody("request-payment-overdue"), amount: 20.01 } }))
      .rejects.toMatchObject({ code: "conflict", message: "Le montant saisi dépasse le solde restant pour ce type de frais." });
    await expect(executeFinancialOperation({ db: partiallyPaidDb, caller: cashier, body: { ...paymentBody("request-payment-exact"), amount: 20 } }))
      .resolves.toMatchObject({ payment: { amount: 20 } });

    const soldDb = fakeDb({
      ...baseSeed(),
      "payments/payment-existing": { id: "payment-existing", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 1_000 },
    });
    await expect(executeFinancialOperation({ db: soldDb, caller: cashier, body: paymentBody("request-payment-sold") }))
      .rejects.toMatchObject({ code: "conflict", message: "Ce type de frais est déjà soldé." });
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

  it("préserve atomiquement le solde face à deux paiements concurrents distincts", async () => {
    const db = fakeDb(baseSeed());
    const results = await Promise.allSettled([
      executeFinancialOperation({ db, caller: cashier, body: { ...paymentBody("request-payment-race-a"), amount: 600 } }),
      executeFinancialOperation({ db, caller: cashier, body: { ...paymentBody("request-payment-race-b"), amount: 600 } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "conflict", message: "Le montant saisi dépasse le solde restant pour ce type de frais." });
    const storedTotal = [...db.documents.entries()]
      .filter(([path]) => path.startsWith("payments/"))
      .reduce((total, [, payment]) => total + Number(payment.amount), 0);
    expect(storedTotal).toBe(600);
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
