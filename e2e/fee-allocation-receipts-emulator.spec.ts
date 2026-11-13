import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import handler from "../api/manage-financial-transaction.js";
import { fixture, invoke } from "./support/emulatorRecipe";
import { feeAllocationAnchorId, feeAllocationStateId } from "../api/_lib/feeAllocationReceipts.js";
import { feeAllocationConfigId } from "../api/_lib/feeAllocationPhase1.js";
import { validateFeeAllocationRubrics } from "../api/_lib/feeAllocationMath.js";

test("encaissements répartis : Auth réel, concurrence, arriérés, social, tiers, corrections et refus", async () => {
  test.setTimeout(240_000);
  const f = fixture();
  try {
    await f.seed(["cashier", "school_admin", "coordination_admin", "sub_coordination_admin", "teacher"]);
    const student = `${f.tag}-student`, fee = `${f.tag}-fee`, version = `${f.tag}-version`;
    const rubrics = [{ id: "a".repeat(32), name: "Fonctionnement", mode: "percent", basisPoints: 2000 },
      { id: "b".repeat(32), name: "Salaire", mode: "fixed", fixedMinor: 4000 }, { id: "c".repeat(32), name: "Prime", mode: "percent", basisPoints: 2500 }];
    const shares = validateFeeAllocationRubrics(rubrics, 10000).shares;
    const cutoffAt = new Date(Date.now() - 60_000).toISOString();
    await f.put(`feeAllocationStates/${feeAllocationStateId(f.school, f.year, "CDF")}`, { schoolId: f.school, schoolYearId: f.year,
      currency: "CDF", status: "EN_PREPARATION", phase3FixtureId: f.tag, cutoffAt });
    await f.put(`students/${student}`, { id: student, schoolId: f.school, schoolYearId: f.year, status: "ACTIVE", className: "1ère Secondaire", nom: "Fictif", createdAt: "2026-09-02" });
    await f.put(`feeTypes/${fee}`, { id: fee, schoolId: f.school, schoolYearId: f.year, name: "Minerval test", className: "1ère Secondaire", amount: 100, createdAt: "2026-09-01" });
    const configId = feeAllocationConfigId(f.school, f.year, fee);
    await f.put(`feeAllocationConfigs/${configId}`, { id: configId, schoolId: f.school, schoolYearId: f.year, feeTypeId: fee, currentVersionId: version });
    // Fixture-only published snapshot; the public publish/activate endpoints stay blocked.
    await f.put(`feeAllocationVersions/${version}`, { id: version, configId, schoolId: f.school, schoolYearId: f.year, feeTypeId: fee,
      className: "1ère Secondaire", currency: "CDF", feeAmountMinor: 10000, status: "published", effectiveFrom: "2026-09-01", rubrics, shares });
    const token = await f.token("cashier"), adminToken = await f.token("school_admin");
    let seq = 0;
    const request = (amount: number, extra = {}) => ({ action: "create-payment", schoolYearId: f.year, studentId: student,
      feeTypeId: fee, amount, clientRequestId: `${f.tag}-receipt-${++seq}`, ...extra });
    const good = async (body: Record<string, unknown>, authorization = token) => {
      const result = await invoke(handler, authorization, body);
      expect(result, `Réponse métier ${String(result.payload.code ?? "")}`).toMatchObject({ status: 200 });
      return result.payload;
    };
    const ledger = async () => (await f.db.collection("feeAllocationMovements").where("schoolId", "==", f.school).get()).docs.map(d => d.data());
    const firstBody = request(30);
    const repeated = await Promise.all([good(firstBody), good(firstBody)]);
    expect(repeated.filter(r => r.idempotent)).toHaveLength(1);
    expect((await ledger())).toHaveLength(1);
    await Promise.all([good(request(20)), good(request(50))]);
    const original = await ledger();
    expect(original).toHaveLength(3); expect(original.reduce((n, m) => n + m.amountMinor, 0)).toBe(10000);
    for (const m of original) expect(m.lines.reduce((n: number, l: { amountMinor: number }) => n + l.amountMinor, 0)).toBe(m.amountMinor);
    const first = repeated[0].payment as { id: string; updatedAt: string };
    const correction = { action: "update-payment", transactionId: first.id, amount: 20, reason: "Correction fictive", confirmation: "MODIFIER CE PAIEMENT", expectedUpdatedAt: first.updatedAt, clientRequestId: `${f.tag}-correction` };
    await good(correction, adminToken); await good(correction, adminToken);
    expect((await ledger()).reduce((n, m) => n + m.amountMinor, 0)).toBe(9000);
    await good({ action: "delete-payment", transactionId: first.id, reason: "Annulation fictive", clientRequestId: `${f.tag}-delete` }, adminToken);
    expect((await ledger()).reduce((n, m) => n + m.amountMinor, 0)).toBe(7000);
    for (const m of original) expect((await f.db.doc(`feeAllocationMovements/${m.id}`).get()).data()).toEqual(m);

    // Arrears retain their original anchor; absence of that proof means UNALLOCATED.
    await f.put(`feeAllocationStates/${feeAllocationStateId(f.school, f.year, "USD")}`, { schoolId: f.school, schoolYearId: f.year,
      currency: "USD", status: "EN_PREPARATION", phase3FixtureId: f.tag, cutoffAt });
    for (const [suffix, configured] of [["old1", true], ["old2", false]] as const) {
      const oldYear = `${f.tag}-${suffix}`, oldStudent = `${oldYear}-student`, oldFee = `${oldYear}-fee`, oldVersion = `${oldYear}-version`;
      await f.put(`schoolYears/${oldYear}`, { schoolId: f.school, name: configured ? "2025-2026" : "2024-2025", status: "archived", startsAt: configured ? "2025-09-01" : "2024-09-01", currency: configured ? "CDF" : "USD" });
      await f.put(`students/${oldStudent}`, { schoolId: f.school, schoolYearId: oldYear, className: "1ère Secondaire", status: "ACTIVE",
        ...(!configured ? {} : { importedFromStudentId: `${f.tag}-old2-student` }) });
      await f.put(`feeTypes/${oldFee}`, { schoolId: f.school, schoolYearId: oldYear, name: "Ancien minerval", className: "1ère Secondaire", amount: 100 });
      if (configured) {
        const historicalShares = validateFeeAllocationRubrics([{ ...rubrics[0], basisPoints: 5000 }], 10000).shares;
        await f.put(`feeAllocationVersions/${oldVersion}`, { id: oldVersion, schoolId: f.school, schoolYearId: oldYear, feeTypeId: oldFee,
          className: "1ère Secondaire", currency: "CDF", feeAmountMinor: 10000, status: "superseded", effectiveFrom: "2025-09-01", rubrics: [{ ...rubrics[0], basisPoints: 5000 }], shares: historicalShares });
        const anchorId = feeAllocationAnchorId({ schoolId: f.school, schoolYearId: oldYear, studentId: oldStudent, feeTypeId: oldFee, currency: "CDF" });
        await f.put(`feeAllocationAnchors/${anchorId}`, { id: anchorId, schoolId: f.school, originSchoolYearId: oldYear, studentId: oldStudent,
          feeTypeId: oldFee, currency: "CDF", configVersionId: oldVersion, feeAmountMinor: 10000, className: "1ère Secondaire", classOptionKey: null, anchoredAt: "2025-09-02" });
      }
    }
    await f.db.doc(`students/${student}`).update({ importedFromStudentId: `${f.tag}-old1-student` });
    for (const suffix of ["old1", "old2"]) {
      const oldYear = `${f.tag}-${suffix}`;
      await good(request(30, { feeTypeId: `${oldYear}-fee`, debtSchoolYearId: oldYear }));
      await good(request(70, { feeTypeId: `${oldYear}-fee`, debtSchoolYearId: oldYear }));
      const entries = (await ledger()).filter(m => m.originSchoolYearId === oldYear);
      expect(entries).toHaveLength(2); expect(entries.reduce((n, m) => n + m.amountMinor, 0)).toBe(10000);
      expect(entries.every(m => m.collectionSchoolYearId === f.year)).toBe(true);
      expect(entries.every(m => m.currency === (suffix === "old1" ? "CDF" : "USD"))).toBe(true);
      if (suffix === "old1") expect(entries.every(m => m.configVersionId === `${oldYear}-version`)).toBe(true);
      else expect(entries.every(m => m.configVersionId === null && m.lines.length === 1 && m.lines[0].rubricId === "UNALLOCATED")).toBe(true);
    }

    // School reduction and unpaid commitments create no ledger entry.
    const socialStudent = `${f.tag}-social`;
    await f.put(`students/${socialStudent}`, { id: socialStudent, schoolId: f.school, schoolYearId: f.year, status: "ACTIVE", className: "1ère Secondaire", createdAt: "2026-09-02",
      financialSupport: { d: { id: "d", schoolYearId: f.year, lines: { [fee]: { reductionMinor: 5000, commitmentMinor: 3000 } } } } });
    const beforeSocial = (await ledger()).length;
    await good(request(20, { studentId: socialStudent }));
    const thirdBody = request(30, { studentId: socialStudent, supportDecisionId: "d" });
    const third = await good(thirdBody); await good(thirdBody);
    expect((await ledger()).length).toBe(beforeSocial + 2);
    const thirdPayment = third.payment as { id: string };
    expect((await invoke(handler, adminToken, { action: "delete-payment", transactionId: thirdPayment.id, reason: "Interdit", clientRequestId: `${f.tag}-third-delete` })).status).toBe(409);
    for (const role of ["coordination_admin", "sub_coordination_admin", "teacher", "school_admin"]) expect((await invoke(handler, await f.token(role), request(1))).status).toBe(403);
    expect((await invoke(handler, token, request(1, { rubricId: "forged" }))).status).toBe(400);
    expect((await invoke(handler, adminToken, { action: "fee-allocation.activate" })).status).toBe(409);
    await f.db.doc(`users/${f.accounts.cashier.uid}`).update({ active: false });
    expect((await invoke(handler, token, request(1))).status).toBe(403);
    await f.db.doc(`users/${f.accounts.cashier.uid}`).update({ active: true });
    await f.put(`students/${f.tag}-foreign`, { schoolId: f.other, schoolYearId: f.year, status: "ACTIVE" });
    expect((await invoke(handler, token, request(1, { studentId: `${f.tag}-foreign` }))).status).toBe(400);
    for (const collection of ["feeAllocationMovements", "feeAllocationBalances", "feeAllocationAnchors", "feeAllocationVersions"]) {
      const denied = await fetch(`http://127.0.0.1:8080/v1/projects/demo-acadea/databases/(default)/documents/${collection}/${f.tag}-forged`, {
        method: "PATCH", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { schoolId: { stringValue: f.school } } }) });
      expect(denied.status).toBe(403);
    }
    const all = await ledger();
    await writeFile(test.info().outputPath("phase3-receipts-proof.json"), JSON.stringify({ environment: "demo-acadea emulators", movements: all.length,
      concurrency: "PASS", arrears: "PASS", socialAndThirdParty: "PASS", permissions: "PASS",
      sourceTotalsMinor: Object.fromEntries(["CDF", "USD"].map(currency => [currency, all.filter(m => m.currency === currency).reduce((n, m) => n + m.amountMinor, 0)])), realActivation: false }));
  } finally { await f.cleanup(); }
});
