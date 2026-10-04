import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeeType, Payment, Student } from "../../types";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { formatCurrencyMoney } from "../../utils/currency";

const record = readFileSync(new URL("./CoordinationStudentRecord.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../../components/students/StudentDetailPage.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("./CoordinationControl.tsx", import.meta.url), "utf8");
const students = readFileSync(new URL("./CoordinationStudents.tsx", import.meta.url), "utf8");
describe("Fiche Coordination — en-tête Contrôle", () => {
  it("identifie explicitement le parcours Contrôle sans changer la fiche Admin", () => {
    expect(control).toContain('<CoordinationStudentRecord context="control"');
    expect(detail).toContain('{!header && <button onClick={onBack}');
    expect(detail).toContain('{header ?? <article');
  });
  it("remplace photo et gros retour par flèche, nom flexible et PDF à droite", () => {
    const header = record.slice(record.indexOf('header={context === "control"'), record.indexOf('</header>'));
    expect(header).toContain('aria-label="Retour au contrôle"');
    expect(header).toContain('min-w-0 flex-1 break-words');
    expect(header.indexOf('Imprimer PDF')).toBeGreaterThan(header.indexOf('</h1>'));
    expect(header).not.toContain('<img');
    expect(header).not.toContain('Retour à la liste');
    expect(header).toContain('onClick={onBack}');
  });
  it("ne propose le PDF individuel que depuis Contrôle, jamais depuis Élèves", () => {
    expect(record.match(/>Imprimer PDF</g)).toHaveLength(1);
    expect(record).toContain('context = "students"');
    expect(students).toContain('<CoordinationStudentRecord student=');
    expect(students).not.toContain('context="control"');
    const header = record.slice(record.indexOf('header={context === "control"'), record.indexOf('</header>'));
    expect(header).toContain('>Imprimer PDF<');
  });
  it("affiche les informations connues sans attendre les arriérés, sans faux solde ni faux parent", () => {
    expect(record).not.toContain('Promise.all([loadCoordinationStudentFinancialDetails');
    expect(record).not.toContain('{!loading && <>');
    expect(record).toContain('financialLoading={loading}');
    expect(record).toContain('parentLoading={parentLoading}');
    expect(record).toContain('disabled={loading || arrearsLoading || Boolean(detailError || arrearsError)}');
    expect(detail).toContain('financialLoading ? <p role="status">Chargement des paiements…');
    expect(record).toContain('arrearsLoading ? <p role="status">Chargement des arriérés…');
    expect(record).toContain('if (!cancelled)');
  });
  it("réserve le résumé financier puis les arriérés au parcours Contrôle, avant les autres sections", () => {
    expect(record).toContain('beforeDetails={context === "control" ? financialOverview : undefined}');
    expect(record).toContain('showPaymentSummary={context !== "control"}');
    expect(record).toContain('Dettes des années antérieures');
    expect(record.indexOf('Total attendu')).toBeLessThan(record.indexOf('{arrearsCard}'));
    expect(detail.indexOf('{beforeDetails}')).toBeLessThan(detail.indexOf('<FormPanel title="Informations générales">'));
    expect(students).toContain('<CoordinationStudentRecord student=');
    expect(students).not.toContain('context="control"');
  });
  it("reprend les montants canoniques de l'année de l'élève sans additionner les arriérés historiques", () => {
    const student = { id: "student-a", schoolId: "school-a", schoolYearId: "year-current", className: "1ère Humanité", option: "Sciences" } as Student;
    const fees = [
      { id: "fee-a", schoolId: "school-a", schoolYearId: "year-current", name: "Inscription", amount: 100 },
      { id: "fee-b", schoolId: "school-a", schoolYearId: "year-current", name: "Minerval", amount: 50 },
    ] as FeeType[];
    const payments = [
      { id: "pay-a", schoolId: "school-a", schoolYearId: "year-current", studentId: "student-a", feeTypeId: "fee-a", amount: 40 },
      { id: "old-debt", schoolId: "school-a", schoolYearId: "year-old", studentId: "student-a", feeTypeId: "fee-b", amount: 25 },
    ] as Payment[];
    expect(record).toContain("getStudentFeeSummaries(student, financial.feeTypes, financial.payments)");
    const totals = getStudentFeeSummaries(student, fees, payments.filter((payment) => payment.schoolYearId === student.schoolYearId))
      .reduce((sum, fee) => ({ expected: sum.expected + fee.expected, paid: sum.paid + fee.paid, remaining: sum.remaining + fee.remaining }), { expected: 0, paid: 0, remaining: 0 });
    expect(totals).toEqual({ expected: 150, paid: 40, remaining: 110 });
    expect(formatCurrencyMoney(totals.remaining, "CDF")).toContain("FC");
  });
});
