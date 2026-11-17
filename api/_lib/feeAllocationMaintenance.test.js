// Lot 27a-bis — protections de la répartition des frais : reprise automatique (création, correction,
// suppression), alerte après une heure, contrôle de nuit au centime près, jamais deux répartitions.
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { runAllocationMaintenance, runAllocationNightlyCheck } from "./feeAllocationMaintenance.js";
import { retryPendingFeeAllocations } from "./feeAllocationPending.js";
import { verifyMaintenanceCaller } from "./maintenanceAuth.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const rubricId = "a".repeat(32), at = "2026-11-13T10:00:00.000Z";
let sequence = 0;
afterEach(() => vi.unstubAllEnvs());

const lifecycle = (db, action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `protection-${++sequence}-request`, ...extra } });
/** Base en mémoire enrichie : requêtes « in » et « >= », lots d'écritures, et vraie concurrence optimiste
 * (comme Firestore : une opération qui a lu un document modifié entre-temps est rejouée). */
function enrich(db) {
  const versions = new Map(); const bump = (path) => versions.set(path, (versions.get(path) ?? 0) + 1);
  const baseDoc = db.doc;
  db.doc = (path) => ({ ...baseDoc(path), set: async (data, options) => { db.records.set(path, options?.merge ? { ...db.records.get(path), ...data } : data); bump(path); } });
  const query = (name, filters = [], max = Infinity) => ({
    where: (k, op, v) => query(name, [...filters, [k, op, v]], max), limit: (n) => query(name, filters, n), orderBy: () => query(name, filters, max), select: () => query(name, filters, max),
    get: async () => { db.reads = (db.reads ?? 0) + 1;
      const docs = [...db.records].filter(([p]) => p.startsWith(`${name}/`) && p.split("/").length === 2)
        .filter(([, d]) => filters.every(([k, op, v]) => op === "==" ? d[k] === v : op === "in" ? v.includes(d[k]) : op === ">=" ? String(d[k]) >= String(v) : false))
        .slice(0, max).map(([p, d]) => ({ id: p.split("/")[1], ref: db.doc(p), exists: true, data: () => structuredClone(d) }));
      return { docs, empty: docs.length === 0, size: docs.length }; } });
  db.collection = query;
  db.batch = () => { const ops = []; return { set: (ref, data, options) => ops.push([ref.path, data, options]),
    commit: async () => ops.forEach(([p, d, o]) => { db.records.set(p, o?.merge ? { ...db.records.get(p), ...d } : d); bump(p); }) }; };
  db.runTransaction = async (fn) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const seen = new Map(); const changes = []; let writing = false;
      const snap = (path) => ({ id: path.split("/").at(-1), exists: db.records.has(path), data: () => structuredClone(db.records.get(path)) });
      const write = (op, ref, data) => { writing = true; changes.push([op, ref.path, data]); };
      const result = await fn({ get: async (ref) => { if (writing) throw Error("read after write"); if (!ref.path) return ref.get(); seen.set(ref.path, versions.get(ref.path) ?? 0); await Promise.resolve(); return snap(ref.path); },
        create: (r, d) => write("create", r, d), update: (r, d) => write("update", r, d), set: (r, d, o) => write(o?.merge ? "update" : "set", r, d), delete: (r) => write("delete", r) });
      // Concurrence optimiste : si un document lu a changé entre-temps, l'opération est rejouée.
      if ([...seen].some(([p, v]) => (versions.get(p) ?? 0) !== v)) continue;
      if (changes.some(([op, p]) => op === "create" && db.records.has(p))) throw Error("already exists");
      changes.forEach(([op, p, d]) => { op === "delete" ? db.records.delete(p) : db.records.set(p, op === "update" ? { ...db.records.get(p), ...d } : d); bump(p); });
      return result;
    }
    throw Error("contention");
  };
  return db;
}
async function activeSchool() {
  const db = completeAllocationFixture();
  db.records.set("users/super", { role: "super_admin", active: true, name: "Équipe ACADÉA" });
  await lifecycle(db, "publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle(db, "prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle(db, "approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle(db, "activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  return enrich(db);
}
const pay = (db, amount, key) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key } });
const correct = (db, payment, amount, key) => executeFinancialOperation({ db, caller: admin, now: "2026-11-13T11:30:00.000Z", body: { action: "update-payment", transactionId: payment.id, amount, reason: "Correction test", confirmation: "MODIFIER CE PAIEMENT", expectedUpdatedAt: payment.updatedAt ?? payment.createdAt, clientRequestId: key } });
const remove = (db, payment, key) => executeFinancialOperation({ db, caller: admin, now: "2026-11-13T11:40:00.000Z", body: { action: "delete-payment", transactionId: payment.id, reason: "Suppression test", clientRequestId: key } });
const list = (db, prefix) => [...db.records].filter(([p]) => p.startsWith(prefix)).map(([, v]) => v);
const received = (db) => list(db, "feeAllocationBalances/").reduce((n, b) => n + (b.receivedMinor ?? 0), 0);
const breakVersion = (db) => { const v = db.records.get("feeAllocationVersions/version"); db.records.delete("feeAllocationVersions/version"); return () => db.records.set("feeAllocationVersions/version", v); };

describe("lot 27a-bis — tâche des 10 minutes", () => {
  it("économe : une seule lecture quand rien n'est en attente", async () => {
    const db = await activeSchool(); db.reads = 0;
    expect(await runAllocationMaintenance({ db, now: "2026-11-13T12:00:00.000Z" })).toEqual({ pending: 0, processed: 0, alerts: 0 });
    expect(db.reads).toBe(1);
  });
  it("reprend toute seule une création en attente, sans écran ni utilisateur", async () => {
    const db = await activeSchool(); const restore = breakVersion(db);
    // Incident durable pendant le paiement ET ses reprises immédiates.
    await pay(db, 40, "maintenance-create-0001");
    expect(list(db, "feeAllocationPending/").map((p) => p.status)).toEqual(["pending"]);
    restore();
    expect(await runAllocationMaintenance({ db, now: "2026-11-13T11:10:00.000Z" })).toMatchObject({ processed: 1, alerts: 0 });
    expect(received(db)).toBe(4000);
  });
  it("reprend une correction à partir de ce qui est enregistré (copie gardée dans le dernier mouvement)", async () => {
    const db = await activeSchool(); const { payment } = await pay(db, 40, "maintenance-correct-0001");
    expect(received(db)).toBe(4000);
    const restore = breakVersion(db); await correct(db, payment, 25, "maintenance-correct-0002");
    expect(list(db, "feeAllocationPending/")).toEqual([expect.objectContaining({ kind: "correction", status: "pending" })]);
    expect(received(db)).toBe(4000); // pas encore reprise
    restore(); await runAllocationMaintenance({ db, now: "2026-11-13T11:45:00.000Z" });
    expect(received(db)).toBe(2500);
    expect(list(db, "feeAllocationMovements/").filter((m) => m.sourceType === "payment").map((m) => m.type).sort()).toEqual(["correction", "receipt"]);
  });
  it("reprend une suppression à partir de ce qui est enregistré", async () => {
    const db = await activeSchool(); const { payment } = await pay(db, 40, "maintenance-delete-0001");
    const restore = breakVersion(db); await remove(db, payment, "maintenance-delete-0002");
    expect(list(db, "feeAllocationPending/")).toEqual([expect.objectContaining({ kind: "deletion", status: "pending" })]);
    restore(); await runAllocationMaintenance({ db, now: "2026-11-13T11:50:00.000Z" });
    expect(received(db)).toBe(0);
    expect(list(db, "feeAllocationPending/")[0].status).toBe("done");
  });
  it("alerte l'Administrateur et le Super administrateur après une heure, une seule fois", async () => {
    const db = await activeSchool(); breakVersion(db); await pay(db, 40, "maintenance-alert-0001");
    expect(await runAllocationMaintenance({ db, now: "2026-11-13T11:30:00.000Z" })).toMatchObject({ alerts: 0 });
    expect(await runAllocationMaintenance({ db, now: "2026-11-13T12:05:00.000Z" })).toMatchObject({ alerts: 2 });
    const alerts = list(db, "notifications/").filter((n) => n.type === "allocation_alert");
    expect(alerts.map((n) => n.recipientUserId).sort()).toEqual(["admin", "super"]);
    expect(alerts.find((n) => n.recipientUserId === "super")).toMatchObject({ platformMessage: true, read: false });
    expect(alerts.find((n) => n.recipientUserId === "admin")).toMatchObject({ schoolId: "school", read: false });
    await runAllocationMaintenance({ db, now: "2026-11-13T12:15:00.000Z" });
    expect(list(db, "notifications/").filter((n) => n.type === "allocation_alert")).toHaveLength(2);
  });
});

describe("lot 27a-bis — jamais deux répartitions", () => {
  it("plusieurs reprises simultanées du même paiement : un seul mouvement, soldes comptés une fois", async () => {
    const db = await activeSchool(); const restore = breakVersion(db);
    await pay(db, 40, "concurrent-0001"); restore();
    const results = await Promise.all([1, 2, 3].map(() => retryPendingFeeAllocations({ db, caller: null, schoolId: "school", now: "2026-11-13T12:00:00.000Z" })));
    expect(results.reduce((n, r) => n + r.processed, 0)).toBeGreaterThanOrEqual(1);
    expect(list(db, "feeAllocationMovements/").filter((m) => m.sourceType === "payment")).toHaveLength(1);
    expect(received(db)).toBe(4000);
  });
});

describe("lot 27a-bis — contrôle de nuit", () => {
  it("encaissé = réparti au centime près : aucune alerte ; un écart déclenche l'alerte détaillée au Super administrateur", async () => {
    const db = await activeSchool();
    await pay(db, 40, "nightly-0001");
    const clean = await runAllocationNightlyCheck({ db, now: "2026-11-14T00:30:00.000Z" });
    expect(clean).toMatchObject({ checked: 1, gaps: [] });
    expect(list(db, "feeAllocationChecks/")[0]).toMatchObject({ collectedMinor: 4000, allocatedMinor: 4000, gapMinor: 0 });
    // Écart artificiel : 1 $ réparti en trop.
    const [path, balance] = [...db.records].find(([p, v]) => p.startsWith("feeAllocationBalances/") && v.rubricId === rubricId);
    db.records.set(path, { ...balance, receivedMinor: balance.receivedMinor + 100 });
    const gap = await runAllocationNightlyCheck({ db, now: "2026-11-15T00:30:00.000Z" });
    expect(gap.gaps).toEqual([expect.objectContaining({ gapMinor: -100 })]);
    const alert = list(db, "notifications/").find((n) => n.recipientUserId === "super" && n.title.includes("écart"));
    expect(alert.body).toContain("encaissé 40.00 USD");
    expect(alert.body).toContain("écart -1.00 USD");
  });
  it("un paiement encore en attente n'est pas compté comme un écart", async () => {
    const db = await activeSchool(); breakVersion(db); await pay(db, 40, "nightly-pending-0001");
    expect((await runAllocationNightlyCheck({ db, now: "2026-11-14T00:30:00.000Z" })).gaps).toEqual([]);
  });
});

describe("lot 27a-bis — seules les tâches Firebase peuvent lancer la maintenance", () => {
  const client = (email, verified = true) => ({ verifyIdToken: async ({ audience }) => ({ getPayload: () => ({ email, email_verified: verified, aud: audience }) }) });
  it("accepte le compte de service des fonctions du même projet, refuse les autres", async () => {
    await expect(verifyMaintenanceCaller("jeton", "acadea-production", client("122814452005-compute@developer.gserviceaccount.com"))).resolves.toMatchObject({ role: "maintenance" });
    await expect(verifyMaintenanceCaller("jeton", "acadea-production", client("1039133094640-compute@developer.gserviceaccount.com"))).rejects.toMatchObject({ status: 403 });
    await expect(verifyMaintenanceCaller("jeton", "acadea-production", client("quelquun@example.com"))).rejects.toMatchObject({ status: 403 });
    await expect(verifyMaintenanceCaller("jeton", "demo-acadea", client("x"))).rejects.toMatchObject({ status: 401 });
    await expect(verifyMaintenanceCaller("jeton", "acadea-production", { verifyIdToken: async () => { throw new Error("signature"); } })).rejects.toMatchObject({ status: 401 });
  });
});
