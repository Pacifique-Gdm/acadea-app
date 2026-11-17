import type { AllocationRow, AllocationFinancialField } from "./feeAllocationView";
import { allocationTotals, allocationFinancialTotals, buildAllocationTables, unavailableAllocation } from "./feeAllocationView";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable } from "./pdf";
import { formatCurrencyMoney } from "./currency";

/** Lot 27c-1 : les trois tableaux du drawer, avec les mêmes colonnes ; textes justifiés ;
 * l'école, l'année et la devise n'apparaissent qu'une fois, dans l'en-tête (contexte). */
const justified = (text: string) => `<p style="text-align: justify">${escapePdfHtml(text)}</p>`;

export function feeAllocationPdfSections(rows: AllocationRow[], filterLabel: string, context: string, periodSelected = false) {
  const operational = rows.some(r => r.financial);
  const receivedLabel = periodSelected ? 'Encaissé sur la période' : 'Encaissé selon le filtre';
  const multipleSchools = new Set(rows.map(r => r.schoolId)).size > 1;
  const money = (minor: number, currency: "CDF" | "USD") => formatCurrencyMoney(minor / 100, currency);
  const name = (row: AllocationRow) => `${row.rubricName}${row.percentLabel ? ` (${row.percentLabel})` : ""}${multipleSchools ? ` · ${row.schoolName}` : ""}${row.percentDetail ? ` — ${row.percentDetail}` : ""}${row.financial ? "" : ` · ${row.feeName} · ${row.classLabel}`}${row.stale ? " · tarif à revérifier" : ""}`;
  const globalFields = ["openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor"] as const;
  const globalLabels = ["Ouverture", "Encaissements cumulés", "Dépenses nettes cumulées", "Solde disponible"];
  const columns = [
    { header: "Rubrique", render: name },
    { header: "Prévu total de l’année", render: (row: AllocationRow) => money(row.amountMinor, row.currency), align: "right" as const },
    { header: receivedLabel, render: (row: AllocationRow) => row.financial ? `${money(row.financial.receivedMinor, row.currency)} (dont arriérés : ${money(row.financial.arrearsMinor, row.currency)})` : "Non disponible" },
    ...(operational ? globalFields.map((field: AllocationFinancialField, i) => ({ header: globalLabels[i], render: (row: AllocationRow) => row.financial ? money(row.financial[field], row.currency) : "Non disponible" })) : []),
  ];
  const totalLine = (table: AllocationRow[]) => allocationTotals(table).map(total => `Total ${total.currency} : prévu ${money(total.amountMinor, total.currency)}${operational ? ` · ${globalLabels.map((label, i) => {
    const value = allocationFinancialTotals(table, globalFields[i]).find(t => t.currency === total.currency)?.value;
    return `${label.toLowerCase()} ${value === null || value === undefined ? unavailableAllocation : money(value, total.currency)}`; }).join(" · ")}` : ""}`).join(" ; ");
  const tables = buildAllocationTables(rows);
  const section = (title: string, table: AllocationRow[]) => pdfSection(title, table.length
    ? `${pdfTable<AllocationRow>(columns, table, "Aucun montant dans ce tableau.")}${justified(totalLine(table))}`
    : justified("Aucun montant dans ce tableau."));
  return [pdfInfoGrid([{ label: "Établissement, année et devise", value: context }, { label: "Filtre", value: filterLabel },
    { label: "Statut", value: operational ? "Registre rapproché" : "Préparatoire — aucune activation financière" }]),
  justified("Prévu total de l’année : frais nets des élèves actifs, réductions et exonérations comprises. Un filtre de période ne réduit pas ce prévu annuel. Solde disponible = ouverture + encaissements cumulés − dépenses nettes cumulées. L'ouverture et les dépenses d'une rubrique sont partagées entre les tableaux 1 et 2 à proportion de leurs encaissements ; le tableau 3 additionne les deux."),
  section("Tableau 1 — Élèves normalement inscrits", tables.one),
  section("Tableau 2 — Cas sociaux et prises en charge", tables.two),
  section("Tableau 3 — Ensemble (tableaux 1 et 2 additionnés)", tables.three),
  justified(operational ? "Les encaissements selon le filtre ne sont pas les encaissements cumulés. La situation globale n'est jamais propre à une classe ou à un frais. Les dépenses nettes comprennent les corrections et annulations. « Non affecté » regroupe les frais sans répartition et le reste des frais répartis à moins de 100 % ; dons exclus. Une rubrique sans aucun montant n'est pas affichée."
    : "Non affecté représente ici les obligations annuelles nettes non réparties, pas une réserve de trésorerie créditée. Le prévu ne crée aucun encaissement ni solde d'ouverture.")];
}
