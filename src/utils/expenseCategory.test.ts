import { describe, expect, it } from "vitest";
import { expenseCategoryLabel } from "./expenseCategory";

describe("libellé de dépense historique", () => {
  it("affiche Main d'œuvre sans changer la valeur persistée", () => {
    expect(expenseCategoryLabel("Salaire")).toBe("Main d'œuvre");
    expect(expenseCategoryLabel("Transport")).toBe("Transport");
  });
});

describe("nature « Autre » précisée", () => {
  it("ajoute la précision seulement pour Autre / Autres", () => {
    expect(expenseCategoryLabel("Autre", " Réparation du portail ")).toBe("Autre — Réparation du portail");
    expect(expenseCategoryLabel("Autres", "Fête de fin d'année")).toBe("Autres — Fête de fin d'année");
    expect(expenseCategoryLabel("Autre")).toBe("Autre");
    expect(expenseCategoryLabel("Transport", "ignorée")).toBe("Transport");
  });
});
