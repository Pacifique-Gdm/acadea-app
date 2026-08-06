import { describe, expect, it } from "vitest";
import { addReportSignatory, groupReportSignatories, normalizeReportSignatories, prepareReportSignatories, removeReportSignatory, reportSignatoriesPdfHtml } from "./reportSignatories";

describe("signataires structurés d'un compte rendu", () => {
  it("ajoute, ordonne et supprime des personnes indépendantes", () => {
    const first = addReportSignatory([], "one").map((item) => ({ ...item, name: "Direction", functionTitle: "Directeur" }));
    const second = addReportSignatory(first, "two").map((item) => item.id === "two" ? { ...item, name: "Secrétariat", functionTitle: "Secrétaire" } : item);
    expect(second).toEqual([{ id: "one", name: "Direction", functionTitle: "Directeur" }, { id: "two", name: "Secrétariat", functionTitle: "Secrétaire" }]);
    expect(removeReportSignatory(second, "one")).toEqual([{ id: "two", name: "Secrétariat", functionTitle: "Secrétaire" }]);
  });

  it("ignore les lignes vides et refuse les lignes partielles ou les doublons exacts", () => {
    expect(prepareReportSignatories([{ id: "empty", name: "", functionTitle: "" }])).toEqual({ items: [], error: "" });
    expect(prepareReportSignatories([{ id: "partial", name: "Direction", functionTitle: "" }]).error).toContain("noms et la fonction");
    expect(prepareReportSignatories([{ id: "one", name: "Direction", functionTitle: "Directeur" }, { id: "two", name: "Direction", functionTitle: "Directeur" }]).error).toContain("deux fois");
  });

  it("lit la nouvelle structure et les anciennes chaînes sans migration", () => {
    expect(normalizeReportSignatories([{ id: "one", name: "Direction", role: "Directeur" }])).toEqual([{ id: "one", name: "Direction", functionTitle: "Directeur" }]);
    expect(normalizeReportSignatories(undefined, "Direction\nSecrétariat")).toEqual([{ id: "legacy-0", name: "Direction", functionTitle: "" }, { id: "legacy-1", name: "Secrétariat", functionTitle: "" }]);
    expect(normalizeReportSignatories(undefined, undefined)).toEqual([]);
  });

  it("répartit les signataires par lignes de trois en conservant l'ordre", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ id: `${index}`, name: `Signataire ${index + 1}`, functionTitle: `Fonction ${index + 1}` }));
    expect(groupReportSignatories(items).map((row) => row.map(({ name }) => name))).toEqual([
      ["Signataire 1", "Signataire 2", "Signataire 3"],
      ["Signataire 4", "Signataire 5", "Signataire 6"],
      ["Signataire 7"],
    ]);
  });

  it("rend un espace manuscrit par personne puis le nom et la fonction sans titre ni soulignement", () => {
    const html = reportSignatoriesPdfHtml([{ id: "one", name: "Aline Test", functionTitle: "Directrice" }, { id: "two", name: "Marc Test", functionTitle: "Secrétaire" }]);
    expect(html.match(/class="report-signatory"/g)).toHaveLength(2);
    expect(html).toContain('<span class="report-signatory-name">Aline Test</span><span class="report-signatory-function">Directrice</span>');
    expect(html).not.toContain("SIGNATURES");
    expect(html).not.toContain("<u>");
    expect(html).not.toContain("border");
  });
});
