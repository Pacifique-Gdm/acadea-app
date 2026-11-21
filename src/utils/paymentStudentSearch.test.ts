import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { showNoPaymentStudentFound } from "./paymentStudentSearch";

const control = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("lot A : « Aucun élève trouvé. » disparaît quand un élève est sélectionné", () => {
  it("cache le message après la sélection, même si le champ affiche « nom | matricule »", () => {
    expect(showNoPaymentStudentFound("KABILA Mbuyi Anne | ACD-26-0001", 0, true)).toBe(false);
  });
  it("garde le message pendant une recherche sans résultat", () => {
    expect(showNoPaymentStudentFound("zzz", 0, false)).toBe(true);
    expect(showNoPaymentStudentFound("   ", 0, false)).toBe(false);
    expect(showNoPaymentStudentFound("kab", 2, false)).toBe(false);
  });
  it("le drawer du caissier utilise cette règle", () => {
    expect(control).toContain("showNoPaymentStudentFound(paymentStudentQuery, paymentStudentResults.length, Boolean(selectedPaymentStudent))");
    expect(control).not.toContain('{paymentStudentQuery.trim() !== "" && paymentStudentResults.length === 0 && (');
  });
});
