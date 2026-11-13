import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import handler from "../api/manage-financial-transaction.js";
import { fixture, invoke } from "./support/emulatorRecipe";

test("cycle rapproché : activation fictive, net de paie, concurrence de dépenses et registre", async () => {
  test.setTimeout(180000);
  const f = fixture(), fixtureId = `e2e-allocation-${randomUUID().replaceAll("-", "")}`;
  try {
    await f.seed(["school_admin", "cashier", "teacher"]);
    await f.db.doc(`schools/${f.school}`).update({ fixtureId });
    await f.db.doc(`feeAllocationTestScopes/${fixtureId}`).create({ fixtureId, schoolId: f.school, schoolIds: [f.school], projectId: "demo-acadea",
      status: "active", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const fee = `${f.tag}-fee`, student = `${f.tag}-student`, rubric = "a".repeat(32);
    await f.put(`feeTypes/${fee}`, { id: fee, schoolId: f.school, schoolYearId: f.year, name: "Minerval", className: "1ère Secondaire", amount: 100, createdAt: new Date().toISOString() });
    const tokens = { admin: await f.token("school_admin"), cashier: await f.token("cashier"), teacher: await f.token("teacher") };
    const good = async (body: Record<string, unknown>, token = tokens.admin) => {
      const r = await invoke(handler, token, body); expect(r, String(r.payload.code)).toMatchObject({ status: 200 }); return r.payload;
    };
    const allocation = (action: string, extra: Record<string, unknown> = {}) => good({ action: `fee-allocation.${action}`, requestId: randomUUID(), ...extra });
    await allocation("save-draft", { feeTypeId: fee, expectedRevision: 0, rubrics: [{ id: rubric, name: "Fonctionnement", mode: "percent", basisPoints: 8000 }] });
    const prepared = await allocation("prepare-version", { feeTypeId: fee, expectedRevision: 1 });
    await allocation("publish-configuration", { versionId: (prepared.version as { id: string }).id });
    await f.put(`students/${student}`, { id: student, schoolId: f.school, schoolYearId: f.year, status: "ACTIVE", className: "1ère Secondaire", createdAt: new Date().toISOString() });
    const opening = await allocation("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId: rubric, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
    await allocation("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
    const activation = { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE", requestId: randomUUID() };
    await allocation("activate", activation); expect((await allocation("activate", activation)).idempotent).toBe(true);
    const payment = { action: "create-payment", schoolYearId: f.year, studentId: student, feeTypeId: fee, amount: 100, clientRequestId: randomUUID() };
    await good(payment, tokens.cashier); expect((await good(payment, tokens.cashier)).idempotent).toBe(true);
    const expense = { action: "create-expense", schoolYearId: f.year, amount: 60, category: "Fournitures", description: "Fictif", beneficiary: "Fictif", paymentMethod: "Espèces", allocationRubricId: rubric };
    const attempts = await Promise.all([1, 2].map(() => invoke(handler, tokens.cashier, { ...expense, clientRequestId: randomUUID() })));
    expect(attempts.map(r => r.status).sort()).toEqual([200, 409]);
    const payroll = { action: "create-personnel-payment", schoolYearId: f.year, beneficiaryId: f.accounts.teacher.uid, kind: "salary", periodMonth: 11, periodYear: 2026,
      paidAt: new Date().toISOString().slice(0, 10), amount: 10, deduction: 2, deductionReason: "Fictif", cnss: 1, tax: 2, recoveries: [], description: "Test", allocationRubricId: rubric, clientRequestId: randomUUID() };
    await good(payroll, tokens.cashier); expect((await good(payroll, tokens.cashier)).idempotent).toBe(true);
    await good({ ...payroll, kind: "bonus", amount: 5, deduction: 0, cnss: 0, tax: 0, clientRequestId: randomUUID() }, tokens.cashier);
    const workspace = await good({ action: "fee-allocation.get-workspace", schoolId: f.school });
    const ledger = workspace.ledger as { balances: { rubricId: string; receivedMinor: number; spentMinor: number; availableMinor: number }[]; movements: unknown[] };
    expect(ledger.balances.find(b => b.rubricId === rubric)).toMatchObject({ receivedMinor: 8000, spentMinor: 7000, availableMinor: 1000 });
    expect(ledger.balances.find(b => b.rubricId === "UNALLOCATED")?.availableMinor).toBe(2000);
    expect(ledger.movements).toHaveLength(5);
    expect((await invoke(handler, tokens.teacher, { ...expense, clientRequestId: randomUUID() })).status).toBe(403);
    expect((await invoke(handler, tokens.admin, { action: "fee-allocation.get-workspace", schoolId: f.other })).status).toBe(403);
    const denied = await fetch(`http://127.0.0.1:8080/v1/projects/demo-acadea/databases/(default)/documents/feeAllocationTestScopes/forged`, {
      method: "PATCH", headers: { Authorization: tokens.admin, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { schoolId: { stringValue: f.school } } }) });
    expect(denied.status).toBe(403);
    await writeFile(test.info().outputPath("allocation-complete-proof.json"), JSON.stringify({ environment: "demo-acadea emulators", receiptMinor: 10000,
      expenseMinor: 7000, availableMinor: 3000, movements: ledger.movements.length, concurrentOverspend: "REFUSED", realActivation: false }));
  } finally { await f.cleanup(); }
});
