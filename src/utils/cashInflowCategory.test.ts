import { describe, expect, it } from "vitest";
import { cashInflowCategoryLabel, cashInflowNatureLabel } from "./cashInflowCategory";

describe("libellés des autres entrées de caisse", () => {
  it("présente les quatre catégories sans changer leur valeur comptable", () => {
    expect((["Subvention", "Don", "Frais de fonctionnement", "Autres"] as const).map(cashInflowCategoryLabel)).toEqual([
      "Subvention", "Don", "Frais de fonctionnement reçus", "Autres",
    ]);
  });
  it("conserve les anciennes natures et affiche la précision des nouvelles entrées Autres", () => {
    expect(cashInflowNatureLabel({ category: "Frais de fonctionnement" })).toBe("Frais de fonctionnement reçus");
    expect(cashInflowNatureLabel({ category: "Autres" })).toBe("Autres");
    expect(cashInflowNatureLabel({ category: "Autres", categoryDetail: "  Recettes de la fête scolaire  " })).toBe("Autres — Recettes de la fête scolaire");
    expect(cashInflowNatureLabel({ category: "Don", categoryDetail: "Valeur cachée" })).toBe("Don");
  });
});
