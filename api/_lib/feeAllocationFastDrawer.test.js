// Lot « répartition rapide » — le drawer ne relit plus tous les élèves à chaque ouverture ;
// il ne se recalcule que si quelque chose a réellement changé, sans jamais servir un prévu périmé.
import { describe, expect, it } from "vitest";
import { manageFeeAllocationPhase2 } from "./feeAllocationPhase2.js";
import { fixture } from "./feeAllocationPhase2.test.js";
import { forecastCacheId, forecastSignalId, FORECAST_CACHE_MAX_AGE_MS } from "./feeAllocationForecast.js";
import { cashRevisionRef, evidenceRevisionRef } from "./feeAllocationRevision.js";
import { allocationStateId } from "./feeAllocationRuntime.js";
import { rubricCatalogId } from "./feeAllocationRubrics.js";

const admin = { uid: "a", role: "school_admin", schoolId: "s" };
/** Compte les lectures Firestore comme la facturation : 1 par document lu, 1 pour une requête vide. */
function counting(db) {
  const counter = { reads: 0, students: 0 };
  const add = (name, snapshot) => { const n = snapshot.docs ? Math.max(1, snapshot.docs.length) : 1; counter.reads += n; if (name === "students") counter.students += snapshot.docs.length; return snapshot; };
  const wrap = (query, name) => new Proxy(query, { get(target, key) {
    const value = target[key];
    if (key === "get") return async () => add(name, await value());
    return typeof value === "function" ? (...args) => wrap(value(...args), name) : value;
  } });
  const doc = (path) => ({ path, get: async () => add(path.split("/")[0], await db.doc(path).get()) });
  const counted = { ...db, doc, collection: (name) => wrap(db.collection(name), name),
    runTransaction: (fn, options) => db.runTransaction((tx) => fn({ ...tx, get: async (ref) => ref.path ? add(ref.path.split("/")[0], await tx.get(ref)) : ref.get() }), options) };
  return { db: counted, counter, reset: () => { counter.reads = 0; counter.students = 0; } };
}
function school(students = 300) {
  const db = fixture();
  db.records.get("feeTypes/f1").classOptionKey = null;
  for (let i = 0; i < students; i++) db.records.set(`students/s-${String(i).padStart(5, "0")}`, { schoolId: "s", schoolYearId: "y", className: "1ère", status: "ACTIVE" });
  return { raw: db, ...counting(db) };
}
const workspace = (db) => manageFeeAllocationPhase2({ db, caller: admin, body: { action: "get-workspace", schoolId: "s" } });
const token = async (db) => (await manageFeeAllocationPhase2({ db, caller: admin, body: { action: "get-forecast-revision", schoolId: "s" } })).token;
const total = (read) => read.forecast.rows.reduce((n, r) => n + r.amountMinor, 0);

describe("lot répartition rapide — prévu gardé côté serveur", () => {
  it("avant : chaque ouverture relisait les 300 élèves ; après : la deuxième ouverture n'en lit aucun", async () => {
    const { db, counter, reset } = school(300);
    const first = await workspace(db);
    const before = { ...counter };
    reset();
    const second = await workspace(db);
    console.info(`[mesure] get-workspace, 300 élèves : 1re ouverture ${before.reads} lectures (${before.students} élèves) ; ouverture suivante ${counter.reads} lectures (${counter.students} élève)`);
    expect(before.students).toBe(300);
    expect(counter.students).toBe(0);
    expect(counter.reads).toBeLessThan(before.reads / 10);
    expect(second.forecast.rows).toEqual(first.forecast.rows);
    expect(total(second)).toBe(3000000);
  });
  it("un élève ajouté (signal des fonctions) : le prévu est recalculé, jamais l'ancien", async () => {
    const { raw, db, counter, reset } = school(10);
    expect(total(await workspace(db))).toBe(100000);
    raw.records.set("students/new", { schoolId: "s", schoolYearId: "y", className: "1ère", status: "ACTIVE" });
    raw.records.set(`feeAllocationForecastSignals/${forecastSignalId("s", "y")}`, { schoolId: "s", schoolYearId: "y", revision: "event-2" });
    reset();
    expect(total(await workspace(db))).toBe(110000);
    expect(counter.students).toBe(11);
  });
  it("un frais modifié ou une répartition enregistrée : recalcul immédiat, même avant le signal", async () => {
    const { raw, db } = school(10);
    await workspace(db);
    raw.records.get("feeTypes/f1").amount = 150;
    expect(total(await workspace(db))).toBe(150000);
    await manageFeeAllocationPhase2({ db, caller: admin, body: { action: "save-drafts", schoolYearId: "y", baseFeeTypeId: "f1", targets: [{ feeTypeId: "f1", expectedRevision: 0 }], requestId: "fast-drawer-0001", rubrics: [{ id: "a".repeat(32), name: "Fonctionnement", mode: "percent", basisPoints: 2000 }] } });
    const rows = (await workspace(db)).forecast.rows.filter((r) => r.feeTypeId === "f1" && r.table === 1);
    expect(rows.find((r) => r.rubricId === "a".repeat(32))?.amountMinor).toBe(30000);
  });
  it("garde-fou : un prévu gardé depuis plus d'une heure est recalculé", async () => {
    const { raw, db, counter, reset } = school(5);
    await workspace(db);
    const path = `feeAllocationForecastCaches/${forecastCacheId("s", "y", "USD")}`;
    raw.records.get(path).savedAt = new Date(Date.now() - FORECAST_CACHE_MAX_AGE_MS - 1000).toISOString();
    reset(); await workspace(db);
    expect(counter.students).toBe(5);
  });
  it("le prévu gardé ne contient aucune identité d'élève", async () => {
    const { raw, db } = school(3);
    raw.records.get("students/s-00001").nom = "CONFIDENTIEL";
    await workspace(db);
    const kept = JSON.stringify(raw.records.get(`feeAllocationForecastCaches/${forecastCacheId("s", "y", "USD")}`));
    expect(kept).not.toContain("CONFIDENTIEL");
    expect(kept).not.toContain("s-00001");
  });
});

describe("lot répartition rapide — empreinte des changements", () => {
  it("quelques lectures, aucun élève ; elle ne change que si quelque chose change réellement", async () => {
    const { raw, db, counter, reset } = school(300);
    const initial = await token(db);
    console.info(`[mesure] vérification des changements : ${counter.reads} lectures (${counter.students} élève)`);
    expect(counter.students).toBe(0);
    expect(counter.reads).toBeLessThanOrEqual(12);
    expect(await token(db)).toBe(initial);
    const changes = [
      ["élève ou frais", `feeAllocationForecastSignals/${forecastSignalId("s", "y")}`, { revision: "event-9" }],
      ["paiement, dépense ou correction", cashRevisionRef(raw, "s", "y", "USD").path, { revision: "cash-2" }],
      ["répartition (preuves)", evidenceRevisionRef(raw, "s", "y").path, { revision: "evidence-2" }],
      ["activation", `feeAllocationStates/${allocationStateId("s", "y", "USD")}`, { status: "ACTIVE" }],
      ["rubriques", `feeAllocationRubricCatalogs/${rubricCatalogId("s", "y")}`, { revision: "catalog-2" }],
      ["répartition en attente", "feeAllocationPending/p1", { schoolId: "s", status: "pending" }],
    ];
    let previous = initial;
    for (const [label, path, data] of changes) {
      raw.records.set(path, { ...(raw.records.get(path) ?? {}), ...data });
      const next = await token(db);
      expect(next, label).not.toBe(previous);
      previous = next;
    }
    reset();
  });
});
