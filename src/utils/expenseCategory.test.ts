import { describe, expect, it } from "vitest";
import { expenseCategoryLabel } from "./expenseCategory";

describe("libellé de dépense historique", () => {
  it("affiche Main d'œuvre sans changer la valeur persistée", () => {
    expect(expenseCategoryLabel("Salaire")).toBe("Main d'œuvre");
    expect(expenseCategoryLabel("Transport")).toBe("Transport");
  });
});
