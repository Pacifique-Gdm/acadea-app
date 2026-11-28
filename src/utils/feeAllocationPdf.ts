import type { AllocationRow, AllocationFinancialField, AllocationSubLine } from "./feeAllocationView";
import { SUB_LINES_LEGEND, allocationTotals, allocationFinancialTotals, buildAllocationTables, noAllocationConfigured, unavailableAllocation, unbreakableMoney } from "./feeAllocationView";
import { escapePdfHtml, pdfSection, pdfTable } from "./pdf";

/** Version 1.20.1 : PDF réduit au titre, à l'école, à l'année, à la date (en-tête), aux tableaux et à leurs totaux.
 * Chaque tableau commence sur une nouvelle page. Plus de longues explications. */
const justified = (text: string) => `<p style="text-align: justify">${escapePdfHtml(text)}</p>`;
/** Une seule ligne courte, sous l'en-tête ou sous un tableau. */
const shortLine = (text: string) => `<p class="fee-allocation-pdf-note" style="margin: 0 18px 6px; font-size: 8pt">${escapePdfHtml(text)}</p>`;

/** Part de la largeur (en %) de chaque colonne : assez pour le plus long mot de chaque en-tête (« Disponible », « Ouverture »). */
/** F2 (28/11/2026) : disponible négatif d'une ligne « ↳ » en rouge. Une marque invisible posée sur la cellule
 * (le texte des cellules est échappé) devient un style rouge une fois le tableau construit. */
const NEGATIVE_MARK = "⁣";
const redNegatives = (html: string) => html.replaceAll(`<span class="cell-inner">${NEGATIVE_MARK}`, '<span class="cell-inner" style="color: #b91c1c" data-negative-available>');
export const FEE_ALLOCATION_PDF_WEIGHTS = { operational: [22, 12, 16, 12, 12, 12, 14], preparatory: [52, 22, 26] } as const;

export function feeAllocationPdfSections(rows: AllocationRow[], filterLabel: string, context: string, periodSelected = false, options: { onlyTableThree?: boolean; configured?: boolean; canAdd?: boolean; filtered?: boolean } = {}) {
  const operational = rows.some(r => r.financial);
  // Version 1.20.1 : en-têtes courts, largeurs fixées, aucun mot coupé (voir FEE_ALLOCATION_PDF_WEIGHTS).
  const receivedLabel = periodSelected ? 'Encaissé (période)' : 'Encaissé (filtre)';
  const multipleSchools = new Set(rows.map(r => r.schoolId)).size > 1;
  // F2 (28/11/2026) : montants insécables, jamais coupés sur deux lignes.
  // 1.43.0 : un montant négatif s'écrit « −$16,67 » / « −16 670,00 FC » partout dans le PDF (lignes de rubrique et totaux aussi).
  const money = (minor: number, currency: "CDF" | "USD") => minor < 0 ? `−${unbreakableMoney(-minor, currency)}` : unbreakableMoney(minor, currency);
  const name = (row: AllocationRow) => `${row.rubricName}${row.percentLabel ? ` (${row.percentLabel})` : ""}${multipleSchools ? ` · ${row.schoolName}` : ""}${row.percentDetail ? ` — ${row.percentDetail}` : ""}${row.financial ? "" : ` · ${row.feeName} · ${row.classLabel}`}${row.stale ? " · tarif à revérifier" : ""}`;
  const globalFields = ["openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor"] as const;
  const globalLabels = ["Ouverture", "Encaissé (cumul)", "Dépensé (cumul)", "Disponible"];
  const weights = FEE_ALLOCATION_PDF_WEIGHTS[operational ? "operational" : "preparatory"];
  // Lignes « ↳ » des sous-rubriques (F2 : toutes les colonnes remplies ; « — » seulement si une donnée manque).
  const subOf = (row: AllocationRow) => (row as AllocationRow & { subLine?: AllocationSubLine }).subLine;
  const subMoney: Record<AllocationFinancialField, (line: AllocationSubLine) => number | null> = { openingMinor: (l) => l.openingMinor, cumulativeReceivedMinor: (l) => l.cumulativeReceivedMinor,
    cumulativeSpentMinor: (l) => l.cumulativeSpentMinor, availableMinor: (l) => l.availableMinor, receivedMinor: (l) => l.receivedMinor ?? null, spentMinor: () => null, arrearsMinor: () => null, formerMinor: () => null };
  const columns = [
    { header: "Rubrique", render: (row: AllocationRow) => subOf(row) ? `↳ ${subOf(row)!.name}` : name(row), weight: weights[0] },
    { header: "Prévu de l’année", render: (row: AllocationRow) => { const sub = subOf(row); return sub ? (sub.plannedMinor === null || sub.plannedMinor === undefined ? "—" : money(sub.plannedMinor, row.currency)) : money(row.amountMinor, row.currency); }, align: "right" as const, weight: weights[1] },
    { header: receivedLabel, weight: weights[2], render: (row: AllocationRow) => subOf(row) ? (subMoney.receivedMinor(subOf(row)!) === null ? "—" : money(subMoney.receivedMinor(subOf(row)!)!, row.currency)) : row.financial ? `${money(row.financial.receivedMinor, row.currency)} (dont arriérés : ${money(row.financial.arrearsMinor, row.currency)}${row.financial.formerMinor ? ` ; dont anciens élèves : ${money(row.financial.formerMinor, row.currency)}` : ""})` : "Non disponible" },
    ...(operational ? globalFields.map((field: AllocationFinancialField, i) => ({ header: globalLabels[i], weight: weights[3 + i], render: (row: AllocationRow) => {
      const sub = subOf(row);
      if (sub) { const value = subMoney[field](sub); return value === null ? "—" : field === "availableMinor" && value < 0 ? `${NEGATIVE_MARK}−${money(-value, row.currency)}` : money(value, row.currency); }
      return row.financial ? money(row.financial[field], row.currency) : "Non disponible"; } })) : []),
  ];
  const totalLine = (table: AllocationRow[]) => allocationTotals(table).map(total => `Total ${total.currency} : prévu ${money(total.amountMinor, total.currency)}${operational ? ` · ${globalLabels.map((label, i) => {
    const value = allocationFinancialTotals(table, globalFields[i]).find(t => t.currency === total.currency)?.value;
    return `${label.toLowerCase()} ${value === null || value === undefined ? unavailableAllocation : money(value, total.currency)}`; }).join(" · ")}` : ""}`).join(" ; ");
  const tables = buildAllocationTables(rows);
  const withSubs = (table: AllocationRow[]) => table.flatMap((row) => [row, ...(row.financial ? row.subLines ?? [] : []).map((subLine) => ({ ...row, key: `${row.key}/${subLine.id}`, subLine }))]);
  // Lot 27c-3a : rubriques de l'année, puis une partie « Arriérés AAAA-AAAA » par année d'origine (mêmes colonnes).
  const parts = (table: AllocationRow[]) => {
    const current = table.filter((row) => !row.arrearsYearName);
    const years = [...new Set(table.filter((row) => row.arrearsYearName).map((row) => row.arrearsYearName!))];
    return `${current.length ? redNegatives(pdfTable<AllocationRow>(columns, withSubs(current), "Aucun montant dans ce tableau.")) : ""}${years.map((year) =>
      `<h3 style="margin: 10px 0 4px; font-size: 9pt">Arriérés ${escapePdfHtml(year)}</h3>${pdfTable<AllocationRow>(columns, table.filter((row) => row.arrearsYearName === year), "Aucun montant.")}`).join("")}`;
  };
  // Le premier tableau suit l'en-tête ; chacun des suivants commence sur une nouvelle page.
  const section = (title: string, table: AllocationRow[], index: number) => pdfSection(title, table.length
    ? `${parts(table)}${table.some((row) => row.financial && row.subLines?.length) ? shortLine(SUB_LINES_LEGEND) : ""}${justified(totalLine(table))}`
    : justified("Aucun montant dans ce tableau."), { className: "fee-allocation-table-pdf-section", pageBreakBefore: index > 0 });
  // Une seule ligne courte, seulement si elle est utile : plusieurs écoles, ou un filtre choisi.
  const head = [...(multipleSchools && context ? [shortLine(context)] : []), ...(options.filtered ? [shortLine(filterLabel)] : [])];
  // Lot du 21/11 : aucune répartition configurée → ni tableaux ni « Non affecté », seulement le message.
  if (options.configured === false) return [...head, justified(noAllocationConfigured(options.canAdd === true))];
  // Lot « Deux onglets » : le personnel ne reçoit que la ligne d'ensemble (tableau 3) des rubriques partagées.
  const shown: [string, AllocationRow[]][] = options.onlyTableThree ? [["Rubriques partagées — ensemble", tables.three]]
    : [["Tableau 1 — Élèves normalement inscrits", tables.one], ["Tableau 2 — Cas sociaux et prises en charge", tables.two], ["Tableau 3 — Ensemble (tableaux 1 et 2 additionnés)", tables.three]];
  return [...head, ...shown.map(([title, table], index) => section(title, table, index))];
}
