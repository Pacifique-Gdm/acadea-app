import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CASHIER_STUDENT_RECORDS_ENABLED, cashierStudentRecordCapabilities } from "./cashierStudentRecords";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const control = read("../modules/control/ControlModule.tsx");
const students = read("../modules/students/StudentsModule.tsx");
const drawer = read("../components/students/StudentRecordDrawer.tsx");
const cashier = { role: "cashier", status: "active", active: true } as const;
const activeYear = { status: "active" } as const;

describe("lot B : fiche élève officielle depuis « Enregistrer un paiement »", () => {
  it("donne au caissier les mêmes droits que le secrétaire sur la fiche élève (lot C)", () => {
    expect(CASHIER_STUDENT_RECORDS_ENABLED).toBe(true);
    expect(cashierStudentRecordCapabilities(cashier, activeYear)).toEqual({ canCreate: true, canEdit: true, canCreateParent: true, canManageOptions: true });
    expect(cashierStudentRecordCapabilities(cashier, activeYear, false).canCreate).toBe(false);
    expect(cashierStudentRecordCapabilities({ ...cashier, status: "inactive" }, activeYear, true).canEdit).toBe(false);
    expect(cashierStudentRecordCapabilities(cashier, { status: "archived" }, true).canCreate).toBe(false);
    expect(cashierStudentRecordCapabilities({ ...cashier, role: "teacher" }, activeYear, true).canCreate).toBe(false);
  });

  it("place le stylo à gauche de la croix du bandeau « Élève sélectionné »", () => {
    const pen = control.indexOf('aria-label="Modifier la fiche de l’élève"');
    const cross = control.indexOf('aria-label="Effacer l’élève sélectionné"');
    expect(pen).toBeGreaterThan(control.indexOf("Élève sélectionné : {selectedPaymentStudent.nom}"));
    expect(pen).toBeLessThan(cross);
    expect(control).toContain('setPaymentStudentRecord({ mode: "edit", student: selectedPaymentStudent })');
  });

  it("met « Ajouter un élève » à gauche de « Enregistrer », sur deux colonnes égales", () => {
    const row = control.slice(control.indexOf('grid min-w-0 grid-cols-2 gap-2'), control.indexOf("{paymentStudentRecord && ("));
    expect(row.indexOf("Ajouter un élève")).toBeGreaterThan(0);
    expect(row.indexOf("Ajouter un élève")).toBeLessThan(row.indexOf('"Enregistrer"'));
    expect(control).toContain('setPaymentStudentRecord({ mode: "create" })');
  });

  it("n'ajoute aucun lien sous « Aucun élève trouvé. »", () => {
    const after = control.slice(control.indexOf("Aucun élève trouvé.</p>"), control.indexOf("Aucun élève trouvé.</p>") + 80);
    expect(after).not.toContain("Ajouter");
    expect(after).not.toContain("<a ");
  });

  it("revient au paiement avec l'élève enregistré sélectionné", () => {
    expect(control).toContain("onSaved={(student) => {");
    expect(control).toContain("selectPaymentStudent(student);");
    expect(control).toContain('setCashierControlFeedbackDrawer("payment");');
  });

  it("utilise la même fiche officielle que l'écran Élèves", () => {
    expect(students).toContain("<StudentRecordDrawer");
    expect(students).not.toContain("<StudentForm");
    expect(control).toContain("<StudentRecordDrawer");
    expect(drawer).toContain('await saveManualStudent(studentForPersistence(studentBeforeParentMutation(student, previousParentId)), exists ? "update" : "create")');
    expect(drawer).toContain('onSaved(persistedStudent, exists ? "Élève modifié avec succès." : "Élève enregistré avec succès.")');
  });
});
