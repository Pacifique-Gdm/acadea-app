import type { AllocationRow, AllocationFinancialField } from "./feeAllocationView";
import { allocationTotals, allocationFinancialTotals, unavailableAllocation } from "./feeAllocationView";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable } from "./pdf";
import { formatCurrencyMoney } from "./currency";

/** Two explicit scopes, from the exact same projection as the authorized drawer. */
export function feeAllocationPdfSections(rows: AllocationRow[], filterLabel: string, context: string) {
  const operational = rows.some(r => r.financial);
  const amount = (currency: "CDF" | "USD", field: AllocationFinancialField) => {
    const value = allocationFinancialTotals(rows, field).find(t => t.currency === currency)?.value;
    return value === null || value === undefined ? unavailableAllocation : formatCurrencyMoney(value / 100, currency);
  };
  const identity = (row: AllocationRow) => `${row.rubricName} · ${row.schoolName} · ${row.yearName} · ${row.currency}${row.financial ? "" : ` · ${row.feeName} · ${row.classLabel} · brouillon v${row.config.draftRevision}`}${row.stale ? " · tarif à revérifier" : ""}`;
  const globalFields = ["openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor"] as const;
  const globalLabels = ["Ouverture", "Encaissements cumulés", "Dépenses nettes cumulées", "Solde disponible"];
  return [pdfInfoGrid([{ label: "Contexte", value: context }, { label: "Filtre", value: filterLabel },
    { label: "Statut", value: operational ? "Registre rapproché — recette fictive uniquement" : "Préparatoire — aucune activation financière" }]),
  pdfSection("Selon le filtre — synthèse par devise", `<p>Prévu : un tarif de référence par classe configurée, sans multiplication par les effectifs ni prise en compte des réductions individuelles. Ce n'est pas un solde disponible.</p>${pdfTable([
    { header: "Devise", render: (row) => row.currency }, { header: "Prévu", render: (row) => formatCurrencyMoney(row.amountMinor / 100, row.currency) },
    { header: "Encaissé selon le filtre", render: row => amount(row.currency, "receivedMinor") },
  ], allocationTotals(rows), "Aucun tarif configuré dans cette vue.")}`),
  ...(operational ? [pdfSection("Situation globale de la rubrique à la fin de la période — synthèse par devise",
    `<p>Indépendante de la classe ou du frais sélectionné. Avec un filtre Frais ou Classe : cumul jusqu'à la dernière écriture disponible. Avec un filtre Période : cumul jusqu'à sa date de fin, y compris les écritures antérieures à son début.</p><p>Solde disponible = ouverture + encaissements cumulés − dépenses nettes cumulées.</p>${pdfTable([
      { header: "Devise", render: (row: { currency: "CDF" | "USD" }) => row.currency },
      ...globalFields.map((field, i) => ({ header: globalLabels[i], render: (row: { currency: "CDF" | "USD" }) => amount(row.currency, field) })),
    ], allocationTotals(rows), "Situation globale indisponible.")}`)] : []),
  pdfSection("Selon le filtre — détail par rubrique", pdfTable<AllocationRow>([
    { header: "Rubrique / périmètre", render: identity },
    { header: "Prévu", render: (row) => formatCurrencyMoney(row.amountMinor / 100, row.currency), align: "right" },
    { header: "Encaissé selon le filtre", render: row => row.financial ? `${formatCurrencyMoney(row.financial.receivedMinor / 100, row.currency)} (dont arriérés : ${formatCurrencyMoney(row.financial.arrearsMinor / 100, row.currency)})` : "Non disponible" },
  ], rows, "Aucune répartition préparée pour ce filtre.")),
  ...(operational ? [pdfSection("Situation globale de la rubrique à la fin de la période — détail", pdfTable<AllocationRow>([
    { header: "Rubrique / périmètre", render: identity },
    ...globalFields.map((field, i) => ({ header: globalLabels[i], render: (row: AllocationRow) => row.financial ? formatCurrencyMoney(row.financial[field] / 100, row.currency) : "Non disponible" })),
  ], rows, "Situation globale indisponible."))] : []),
  `<p>${escapePdfHtml(operational ? "Les encaissements selon le filtre ne sont pas les encaissements cumulés globaux. La situation globale n'est jamais un solde propre à une classe ou à un frais. Les dépenses nettes comprennent les corrections et annulations compensatoires. Non affecté conserve les recettes scolaires sans configuration et les reliquats ; dons exclus."
    : "Non affecté représente ici le reliquat prévisionnel de chaque tarif, pas une réserve de trésorerie créditée. Aucun mouvement, arriéré encaissé ou solde d'ouverture n'est intégré en phase 2.")}</p>`];
}
