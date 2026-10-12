import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const control = readFileSync("src/modules/control/ControlModule.tsx", "utf8");
const form = readFileSync("src/components/personnel/PersonnelPaymentForm.tsx", "utf8");

describe("parcours du paiement du personnel", () => {
  it("conserve la valeur interne du type d'enregistrement", () => {
    expect(control).toContain('<option value="personnel">Paiement du personnel</option>');
  });

  it("ferme le formulaire seulement après la réponse de création et conserve le justificatif", () => {
    expect(form.indexOf("await createPersonnelPayment(")).toBeLessThan(form.indexOf("onRecorded?.(payment)"));
    expect(form).toContain('setBeneficiaryId(""); setKind("salary")');
    expect(control).toContain("setRecordedPersonnelPayment(payment); setCashierControlDrawer(null)");
    expect(control).toContain("printPersonnelPaymentPdf(recordedPersonnelPayment, school)");
    expect(form).toContain('catch (cause) { setError(');
  });
});
