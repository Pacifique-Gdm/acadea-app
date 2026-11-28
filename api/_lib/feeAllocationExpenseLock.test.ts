// F2 1.42.3 (28/11/2026) — défaut trouvé sur le staging : une dépense sur une sous-rubrique restait sans réponse quand le
// prévu gardé était absent, trop ancien (plus d'1 h) ou périmé. La transaction de la dépense lisait le prévu gardé (ce qui
// le verrouille), puis le recalcul voulait l'enregistrer : il attendait le verrou de la dépense, qui l'attendait. Blocage.
// Ici, une base en mémoire note chaque écriture faite sur un document lu par une AUTRE transaction encore ouverte
// (en vrai : une attente sans fin). Il ne doit y en avoir aucune, que le prévu gardé soit ancien, périmé, absent ou récent.
import { describe, expect, it } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { readAllocationForecast } from "./feeAllocationForecast.js";
import { SUB_RUBRICS_PHRASE } from "./feeAllocationSubRubrics.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
let sequence = 0;
type Ref = { path?: string };
type Tx = Record<string, (...args: never[]) => unknown> & { get: (ref: Ref) => Promise<unknown> };

/** Verrous comme sur Firestore : un document lu dans une transaction d'écriture est tenu jusqu'à sa fin. */
function withLocks(db: ReturnType<typeof completeAllocationFixture>) {
  const original = db.runTransaction.bind(db) as (fn: (tx: Tx) => Promise<unknown>, options?: unknown) => Promise<unknown>;
  const held = new Map<string, number>(), blocked: string[] = [];
  let next = 0;
  (db as { runTransaction: unknown }).runTransaction = async (fn: (tx: Tx) => Promise<unknown>, options?: { readOnly?: boolean }) => {
    const id = ++next;
    const check = (ref: Ref) => { const owner = ref.path ? held.get(ref.path) : undefined; if (owner !== undefined && owner !== id) blocked.push(ref.path!); };
    try {
      return await original((tx) => fn({ ...tx,
        get: async (ref: Ref) => { if (!options?.readOnly && ref.path && !held.has(ref.path)) held.set(ref.path, id); return tx.get(ref); },
        create: (ref: Ref, ...rest: never[]) => { check(ref); return tx.create(ref as never, ...rest); },
        update: (ref: Ref, ...rest: never[]) => { check(ref); return tx.update(ref as never, ...rest); },
        set: (ref: Ref, ...rest: never[]) => { check(ref); return tx.set(ref as never, ...rest); },
        delete: (ref: Ref) => { check(ref); return tx.delete(ref as never); } } as Tx), options);
    } finally { for (const [path, owner] of held) if (owner === id) held.delete(path); }
  };
  return blocked;
}

async function school() {
  const db = completeAllocationFixture();
  const lifecycle = (action: string, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `lock-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  db.records.set("payments/old", { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 25, createdAt: "2026-11-01", provenance: "financial-api", clientRequestIdHash: "proof" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 2500, lines: [{ rubricId, amountMinor: 2500 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Personnel", hidden: false });
  const { rubric } = await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, confirmation: SUB_RUBRICS_PHRASE, requestId: `lock-${++sequence}-request`,
    subRubrics: [{ name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: [] }, { name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }] } });
  await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 30, clientRequestId: "lock-payment-0000001" } });
  const caches = () => [...db.records.keys()].filter((key) => key.startsWith("feeAllocationForecastCaches/"));
  const spend = (key: string) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:40:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount: 0.01,
    category: "Fournitures", description: "Achat", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: key, allocationRubricId: rubricId, allocationSubRubricId: rubric.subRubrics[0].id } });
  /** Prévu gardé récent, comme après l'ouverture des tableaux. */
  const keepRecent = () => readAllocationForecast({ db, schoolId: "school", yearId: "year", currency: "USD" });
  const blocked = withLocks(db);
  return { db, caches, spend, keepRecent, blocked };
}

describe("F2 1.42.3 — dépense sur une sous-rubrique : jamais de blocage sur le prévu gardé", () => {
  it("prévu gardé de plus d'1 h : la dépense passe, sans écriture sur un document verrouillé", async () => {
    const { db, caches, spend, keepRecent, blocked } = await school();
    await keepRecent();
    expect(caches().length).toBe(1);
    for (const key of caches()) db.records.set(key, { ...db.records.get(key), savedAt: "2020-01-01T00:00:00.000Z" });
    await spend("lock-expense-old-0001");
    expect(blocked).toEqual([]);
  });

  it("prévu gardé périmé (nouveau frais) : la dépense passe, sans blocage", async () => {
    const { db, spend, keepRecent, blocked } = await school();
    await keepRecent();
    db.records.set("feeTypes/fee-new", { ...db.records.get("feeTypes/fee"), id: "fee-new", name: "Nouveau frais" });
    await spend("lock-expense-stale-01");
    expect(blocked).toEqual([]);
  });

  it("prévu gardé absent : la dépense passe, sans blocage", async () => {
    const { db, caches, spend, blocked } = await school();
    for (const key of caches()) db.records.delete(key);
    await spend("lock-expense-none-001");
    expect(blocked).toEqual([]);
  });

  it("prévu gardé récent : la dépense passe, sans blocage", async () => {
    const { caches, spend, keepRecent, blocked } = await school();
    await keepRecent();
    expect(caches().length).toBe(1);
    await spend("lock-expense-recent-1");
    expect(blocked).toEqual([]);
  });
});
