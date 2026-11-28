// F2 — affichage des soldes des sous-rubriques (décisions de l'utilisateur du 28/11/2026) :
// légende d'une ligne, libellé « $2/élève », PDF identique sur téléphone et ordinateur, montants jamais coupés.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUB_LINES_LEGEND, allocationSubLines, perStudentLabel, unbreakableMoney, type AllocationRow } from "./feeAllocationView";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import { getPdfLayout } from "./pdfSettings";
import { subRubricLabel, subRubricSpendCheck, subRubricSpendError } from "../components/AllocationSubRubricSelect";

const drawer = readFileSync(new URL("../modules/menu/FeeAllocationDrawer.tsx", import.meta.url), "utf8");
const pdfSource = readFileSync(new URL("./pdf.ts", import.meta.url), "utf8");
const subView = (k: number) => [
  { id: "1111111111111111", name: "Craies", mode: "percent" as const, basisPoints: 3000, receivedMinor: 90000 * k, spentMinor: 20000 * k, availableMinor: 70000 * k },
  { id: "2222222222222222", name: "Entretien", mode: "fixed" as const, fixedMinor: 200 * k, receivedMinor: 60000 * k, spentMinor: 0, availableMinor: 60000 * k },
  { id: "UNALLOCATED", name: "Non affecté (Fonctionnement)", receivedMinor: 150000 * k, spentMinor: 10000 * k, availableMinor: 140000 * k }];
const row = (table: 1 | 2, currency: "USD" | "CDF", k: number, withSubs: boolean) => ({ key: `${table}`, schoolId: "s", schoolName: "École", yearName: "2026-2027", feeName: "Minerval",
  classLabel: "Toutes", currency, rubricName: "Fonctionnement", amountMinor: 7200000 * k, percent: 0, config: {}, stale: false, table, rubricId: "r",
  financial: { receivedMinor: 1800000 * k, spentMinor: 30000 * k, availableMinor: 1770000 * k, openingMinor: 0, arrearsMinor: 12345 * k, cumulativeReceivedMinor: 1800000 * k, cumulativeSpentMinor: 30000 * k, formerMinor: 0 },
  ...(withSubs ? { subLines: allocationSubLines({ openingMinor: 0, subView: subView(k) }, currency) } : {}) }) as unknown as AllocationRow;
const pdf = (currency: "USD" | "CDF", k: number, withSubs = true) => feeAllocationPdfSections([row(1, currency, k, withSubs), row(2, currency, k, withSubs)], "Frais : Tous les frais", "", false).join("");
const cells = (html: string) => [...html.matchAll(/<td class="[^"]*"><span class="cell-inner">([^<]*)<\/span><\/td>/g)].map((m) => m[1]);

describe("F2 — affichage des soldes des sous-rubriques", () => {
  it("libellé court : « 30 % » reste, un montant fixe devient « $2/élève » (« 2 000 FC/élève » en francs)", () => {
    expect(perStudentLabel(200, "USD")).toBe("$2/⁠élève");
    expect(perStudentLabel(250, "USD")).toBe("$2,50/⁠élève");
    expect(perStudentLabel(200000, "CDF")).toMatch(/^2.000\u00a0FC\/⁠élève$/);
    const lines = allocationSubLines({ openingMinor: 0, subView: subView(1) }, "USD")!;
    expect(lines.map((l) => l.name)).toEqual(["Craies (30 %)", "Entretien ($2/⁠élève)", "Non affecté (Fonctionnement)"]);
    // Ni espace ordinaire ni passage à la ligne possible à l'intérieur de « $2/élève » (U+2060 après « / »).
    expect(perStudentLabel(500000, "CDF")).not.toMatch(/ |\/(?!⁠)/);
    expect(lines.map((l) => l.name).join(" ")).not.toContain("fixe");
  });

  it("une seule ligne très courte « ↳ = détail de la rubrique », seulement sous un tableau qui a des lignes « ↳ » ; aucun paragraphe d'explication", () => {
    const html = pdf("USD", 1);
    expect(html.split(SUB_LINES_LEGEND)).toHaveLength(4); // tableaux 1, 2 et 3
    expect(pdf("USD", 1, false)).not.toContain(SUB_LINES_LEGEND);
    expect(html).not.toMatch(/ne s'ajoutent pas au total|ne sont pas cliquables|Leur somme est toujours/);
    expect(drawer).toContain("{rows.some((row) => row.financial && row.subLines?.length) && <p className=\"text-xs text-slate-500\" data-sub-lines-legend>{SUB_LINES_LEGEND}</p>}");
    expect(drawer).not.toMatch(/ne s'ajoutent pas au total|Leur somme est toujours/);
  });

  it("un montant n'est jamais coupé sur deux lignes : PDF (espaces insécables, colonnes de montants sans coupure) et écran", () => {
    expect(unbreakableMoney(4500000000, "CDF")).not.toMatch(/ /);
    for (const [currency, k] of [["USD", 1], ["CDF", 2500]] as const) {
      const amounts = cells(pdf(currency, k)).filter((text) => /\d,\d\d/.test(text));
      expect(amounts.length).toBeGreaterThan(20);
      // Aucun espace ordinaire à l'intérieur d'un montant (chiffres, séparateurs, devise).
      for (const text of amounts) for (const amount of text.match(/\$?\d[\d\u00a0\u202f ]*,\d\d(?:[\u00a0 ]FC)?/g) ?? []) expect(amount, `« ${amount} »`).not.toMatch(/ /);
    }
    expect(pdfSource).toContain(".acadea-pdf .fee-allocation-table-pdf-section td:not(:first-child), .acadea-pdf .fee-allocation-table-pdf-section td:not(:first-child) * { overflow-wrap: normal; word-break: keep-all; }");
    // Écran : cellules de montants « whitespace-nowrap » ; « Dont arriérés » et « Dont anciens élèves » aussi.
    expect(drawer).toContain("Dont arriérés selon le filtre : <span className=\"whitespace-nowrap\">");
    expect(drawer).toContain("Dont anciens élèves (prévu et encaissé) : <span className=\"whitespace-nowrap\">");
    expect(drawer).toContain("<td key={i} className={`border-b p-2 whitespace-nowrap ${i === 2 ? \"font-semibold\" : \"\"}`}>");
    expect(drawer).toContain("<td className=\"border-b p-2 whitespace-nowrap\">{formatCurrencyMoney(row.amountMinor / 100, row.currency)}</td>");
  });

  it("PDF identique sur téléphone et ordinateur : page A4 portrait, largeur de rendu fixe, aucun réglage propre à l'appareil", () => {
    const layout = getPdfLayout();
    expect(layout.jsPdfFormat).toBe("a4");
    expect(layout.page.width).toBeLessThan(layout.page.height);
    expect(layout.windowWidth).toBe(688);
    expect(pdfSource).toContain("width: ${renderWidth}px;");
    expect(pdfSource).toContain("windowWidth: layout.windowWidth");
    // L'export de la répartition ne passe ni réglage PDF ni orientation : mêmes valeurs par défaut partout.
    const call = drawer.slice(drawer.indexOf("await renderAcadPdfPreview({ filename: \"repartition-frais.pdf\""), drawer.indexOf("} catch (cause)", drawer.indexOf("repartition-frais.pdf")));
    expect(call).not.toMatch(/pdfSettings|orientation|innerWidth|matchMedia/);
    // Les sections ne dépendent pas de la largeur de l'écran : même contenu quel que soit l'appareil.
    expect(feeAllocationPdfSections.toString()).not.toMatch(/innerWidth|matchMedia|navigator/);
  });
  it("Caissier : la ligne du reste s'appelle « Reste », comme dans les tableaux ; une rubrique d'école garde son nom", () => {
    const options = { required: true, currency: "USD", rubrics: [{ id: "r", name: "Fonctionnement", availableMinor: 900, subRubrics: [
      { id: "1".repeat(16), name: "Craies", availableMinor: 500 }, { id: "UNALLOCATED", name: "Non affecté (Fonctionnement)", availableMinor: 100 }] },
      { id: "UNALLOCATED", name: "Non affecté", availableMinor: 50 }] };
    expect(subRubricLabel({ id: "UNALLOCATED", name: "Non affecté (Fonctionnement)" })).toBe("Reste");
    expect(subRubricLabel({ id: "1".repeat(16), name: "Craies" })).toBe("Craies");
    expect(subRubricSpendError(subRubricSpendCheck({ options }, "r", "UNALLOCATED", 200), "USD")).toContain("Solde insuffisant sur « Reste »");
    const select = readFileSync(new URL("../components/AllocationSubRubricSelect.tsx", import.meta.url), "utf8");
    expect(select).toContain("{subRubricLabel(sub)} — disponible");
    // La rubrique « Non affecté » de l'école (1er champ) n'est jamais renommée.
    expect(readFileSync(new URL("../components/AllocationRubricSelect.tsx", import.meta.url), "utf8")).not.toContain("subRubricLabel");
  });
});
