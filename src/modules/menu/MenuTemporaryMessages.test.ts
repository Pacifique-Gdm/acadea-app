import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/menu/MenuModule.tsx", "utf8");

describe("messages temporaires du Menu Administrateur", () => {
  it("centralise les délais de succès et d'erreur", () => {
    expect(source).toContain("useAutoDismissMessage(schoolSaveMessage");
    expect(source).toContain("useAutoDismissMessage(cashierSuccess");
    expect(source).toContain("useAutoDismissMessage(cashierError");
    expect(source).toContain("SUCCESS_MESSAGE_DURATION_MS");
    expect(source).toContain("ERROR_MESSAGE_DURATION_MS");
  });

  it("couvre les erreurs des différents drawers du Menu", () => {
    ["newFeeError", "newYearError", "yearActionError", "parentDeleteError", "medicalRecordsError", "teacherAccountsError"].forEach((state) => expect(source).toContain(`useAutoDismissMessage(${state}`));
  });

  it("nettoie les messages à la fermeture et avant un changement de drawer", () => {
    expect(source).toContain("function clearMenuMessages()");
    expect(source).toContain("function closeActiveMenuSection()");
    expect(source).toContain("onClose={closeActiveMenuSection}");
    expect(source).toContain("clearMenuMessages(); if (section.id ===");
  });

  it("préserve les annonces accessibles", () => {
    expect(source).toContain('role="alert" aria-live="assertive"');
    expect(source).toContain('role="status" aria-live="polite"');
  });
});
