import { describe, expect, it } from "vitest";
import { readAllocationPages } from "./feeAllocationPagination.js";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { readFeeAllocationLedger } from "./feeAllocationLedger.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { allocationBalanceId } from "./feeAllocationRuntime.js";

describe("lecture exhaustive des répartitions", () => {
  it("prouve la page terminale y compris pour un multiple exact de la taille", async () => {
    const db = completeAllocationFixture();
    for (let i = 0; i < 600; i++) db.records.set(`proof/${String(i).padStart(5, "0")}`, { schoolId: "school" });
    let reads = 0;
    const rows = await db.runTransaction(tx => readAllocationPages(db.collection("proof").where("schoolId", "==", "school"), {
      get: q => { reads++; return tx.get(q); },
    }));
    expect(reads).toBe(4); expect(rows.docs).toHaveLength(600);
    expect(new Set(rows.docs.map(d => d.id)).size).toBe(600);
  });
  it("ne retourne pas de total partiel lorsque la seconde page échoue", async () => {
    const db = completeAllocationFixture();
    for (let i = 0; i < 250; i++) db.records.set(`proof/${i}`, { schoolId: "school" });
    let reads = 0;
    await expect(db.runTransaction(tx => readAllocationPages(db.collection("proof"), { get: q => {
      if (++reads === 2) throw Error("unavailable"); return tx.get(q);
    } }))).rejects.toThrow("unavailable");
  });
  it("refuse une page répétée au lieu de boucler ou compter deux fois", async () => {
    const q = { orderBy: () => q, startAfter: () => q, limit: () => q };
    await expect(readAllocationPages(q, { get: async () => ({ docs: [{ id: "repeated" }] }) }, 1)).rejects.toThrow("répété");
  });
  it("rapproche 2401 mouvements sans tronquer les dernières pages ni inclure une autre école", async () => {
    const db = completeAllocationFixture(), rubricId = "a".repeat(32), caller = { uid: "admin", schoolId: "school", role: "school_admin" };
    const now = "2026-11-13T10:00:00.000Z";
    const action = (action, body) => manageFeeAllocationLifecycle({ db, caller, now, body: { action, requestId: `volume-${action}-request`, ...body } });
    await action("publish-configuration", { versionId: "version" });
    const opening = await action("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
    await action("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
    await action("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
    for (let i = 0; i < 2400; i++) db.records.set(`feeAllocationMovements/m${i}`, { id: `m${i}`, schoolId: "school", collectionSchoolYearId: "year", currency: "USD", sourceType: "payment", type: "receipt", amountMinor: 100, lines: [{ rubricId, amountMinor: 100 }], postedAt: now });
    db.records.set("feeAllocationMovements/foreign", { schoolId: "foreign", collectionSchoolYearId: "year", currency: "USD" });
    Object.assign(db.records.get(`feeAllocationBalances/${allocationBalanceId("school", "year", "USD", rubricId)}`), { receivedMinor: 240000, availableMinor: 240000 });
    const args = { db, schoolId: "school", schoolYearId: "year", currency: "USD", now };
    const ledger = await readFeeAllocationLedger(args);
    expect(ledger.movements).toHaveLength(200);
    expect(ledger.pagination).toMatchObject({ total: 2401, pages: 13, page: 0 });
    const all = [...ledger.movements];
    for (let page = 1; page < ledger.pagination.pages; page++) {
      const next = await readFeeAllocationLedger({ ...args, page, fingerprint: ledger.pagination.fingerprint });
      expect(next.movements.length).toBeLessThanOrEqual(200); all.push(...next.movements);
    }
    expect(all).toHaveLength(2401); expect(new Set(all.map(m => m.id)).size).toBe(2401);
    await expect(readFeeAllocationLedger({ ...args, page: 1 })).rejects.toThrow("continuité");
    db.records.get("feeAllocationMovements/m0").postedAt = "2026-11-13T09:30:00.000Z";
    await expect(readFeeAllocationLedger({ ...args, page: 1, fingerprint: ledger.pagination.fingerprint })).rejects.toThrow("changé");
    expect(ledger.balances.reduce((n, b) => n + b.availableMinor, 0)).toBe(240000);
  });
});
