import { describe, expect, it } from "vitest";
import { cashInflowCategoryLabel } from "./cashInflowCategory";

describe("libellés des autres entrées de caisse", () => {
  it("présente les quatre catégories sans changer leur valeur comptable", () => {
    expect((["Subvention", "Don", "Frais de fonctionnement", "Autres"] as const).map(cashInflowCategoryLabel)).toEqual([
      "Subvention", "Don", "Frais de fonctionnement reçus", "Autres",
    ]);
  });
});
