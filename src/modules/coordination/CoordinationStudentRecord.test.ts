import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  it("réserve la carte d'arriérés au parcours Contrôle après les totaux de paiements", () => {
    expect(record).toContain('afterPayments={context === "control" ? arrearsCard : undefined}');
    expect(record).toContain('Dettes des années antérieures');
    expect(detail.indexOf('{afterPayments}')).toBeGreaterThan(detail.indexOf('<FormPanel title="Paiements">'));
    expect(detail.indexOf('{afterPayments}')).toBeLessThan(detail.indexOf('<FormPanel title="Historique des paiements">'));
    expect(students).toContain('<CoordinationStudentRecord student=');
    expect(students).not.toContain('context="control"');
  });
});
