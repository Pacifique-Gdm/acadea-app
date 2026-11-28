// F2 (28/11/2026) : un disponible négatif de sous-rubrique est en rouge aussi dans la liste du Caissier (avec une ligne
// rouge sous la liste, car une option ne se colore pas toujours sur téléphone) et dans le PDF de la Répartition des frais.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllocationSubRubricSelect, negativeSubRubricMessage } from "../components/AllocationSubRubricSelect";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import type { AllocationRow } from "./feeAllocationView";

const spend = (currency: "USD" | "CDF", availableMinor: number) => ({ options: { required: true, currency, rubrics: [{ id: "personnel", name: "Personnel", availableMinor: 5000,
  subRubrics: [{ id: "1111111111111111", name: "Entretien", availableMinor, functions: [] }, { id: "UNALLOCATED", name: "Reste", availableMinor: 9000, functions: [] }] }] } });
const render = (currency: "USD" | "CDF", availableMinor: number, value: string) =>
  renderToStaticMarkup(createElement(AllocationSubRubricSelect, { spend: spend(currency, availableMinor) as never, rubricId: "personnel", value, onChange: () => undefined }));

describe("F2 — disponible négatif en rouge (Caissier et PDF)", () => {
  it("liste du Caissier : option en rouge et ligne rouge sous la liste, montant au format des tableaux (dollars et francs)", () => {
    const usd = render("USD", -1667, "1111111111111111");
    expect(usd).toContain('style="color:#b91c1c"');
    expect(usd).toContain("data-sub-rubric-negative");
    expect(usd).toContain("Disponible négatif : −$16,67. Aucune dépense possible sur cette sous-rubrique.");
    expect(negativeSubRubricMessage(-1667000, "CDF")).toBe("Disponible négatif : −16\u202f670,00 FC. Aucune dépense possible sur cette sous-rubrique.");
    const cdf = render("CDF", -1667000, "1111111111111111");
    expect(cdf).toContain("Disponible négatif : −16");
    expect(cdf).toContain("670,00 FC. Aucune dépense possible");
    // La ligne rouge ne montre jamais « USD » ni « CDF ».
    for (const html of [usd, cdf]) { const line = html.split("data-sub-rubric-negative")[1]; expect(line).not.toContain("USD"); expect(line).not.toContain("CDF"); }
    // Rien en rouge quand le disponible n'est pas négatif, ni de ligne quand une autre sous-rubrique est choisie.
    expect(render("USD", 0, "1111111111111111")).not.toContain("#b91c1c");
    expect(render("USD", -1667, "UNALLOCATED")).not.toContain("data-sub-rubric-negative");
  });

  it("PDF : la colonne Disponible d'une ligne « ↳ » négative est en rouge, les autres cellules non", () => {
    const sub = (id: string, name: string, availableMinor: number) => ({ id, name, openingMinor: 500, cumulativeReceivedMinor: 1000, cumulativeSpentMinor: 1000 - availableMinor + 500, availableMinor, plannedMinor: 500, receivedMinor: 1000 });
    const row = { key: "r", schoolId: "school", schoolName: "École", yearName: "2026-2027", feeName: "Minerval", table: 1, rubricId: "personnel", classLabel: "1ère", currency: "USD", rubricName: "Personnel",
      amountMinor: 5000, percent: 50, config: { draftRevision: 1 }, stale: false,
      financial: { receivedMinor: 2000, spentMinor: 0, availableMinor: 7333, openingMinor: 1000, arrearsMinor: 0, formerMinor: 0, cumulativeReceivedMinor: 2000, cumulativeSpentMinor: 0 },
      subLines: [sub("1111111111111111", "Entretien", -1667), sub("UNALLOCATED", "Reste", 9000)] } as unknown as AllocationRow;
    const html = feeAllocationPdfSections([row], "Frais : Tous les frais", "École · 2026-2027").join("");
    // Une fois dans le tableau 1, une fois dans le tableau 3 (ensemble).
    expect(html.match(/data-negative-available/g)?.length).toBe(2);
    expect(html).toMatch(/<span class="cell-inner" style="color: #b91c1c" data-negative-available>−\$16,67<\/span>/);
    expect(html).not.toContain("\u2063");
  });
});
