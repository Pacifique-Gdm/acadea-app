import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ControlModule.tsx", import.meta.url), "utf8");
const clear = source.slice(source.indexOf("function clearPaymentStudent()"), source.indexOf("async function savePayment()"));
const reset = source.slice(source.indexOf("function resetStudentDependentPaymentState()"), source.indexOf("function selectPaymentStudent("));

describe("désélection de l’élève du paiement", () => {
  it("propose une croix tactile et accessible au clavier à droite du nom", () => {
    expect(source).toContain('aria-label="Effacer l’élève sélectionné"');
    expect(source).toContain('onClick={clearPaymentStudent}');
    expect(source).toContain('type="button" aria-label="Effacer l’élève sélectionné"');
    expect(source).toContain('h-9 w-9 shrink-0');
    expect(source).toContain('min-w-0 flex-1 break-words');
  });

  it("efface seulement les données du paiement liées à A et rend la recherche réutilisable", () => {
    expect(clear).toContain('setStudentId("")');
    expect(clear).toContain('setPaymentStudentQuery("")');
    expect(clear).toContain('paymentStudentSearchRef.current?.focus()');
    for (const state of ['setFeeTypeId("")', 'setPaymentArrears([])', 'setArrearsError("")', 'setAmount("")', 'setPaymentNote("")', 'paymentAttemptRef.current = null']) expect(reset).toContain(state);
    expect(clear).not.toContain("createPaymentTransaction");
    expect(clear).not.toContain("persistFirestorePatch");
    expect(clear).not.toContain("setSelectedHistoryStudentId");
  });

  it("ignore les réponses d’arriérés devenues obsolètes lors du passage A vers B", () => {
    expect(source).toContain('requestId === paymentStudentRequestRef.current');
    expect(source).toContain('resetStudentDependentPaymentState();\n    setStudentId(student.id)');
  });
});
