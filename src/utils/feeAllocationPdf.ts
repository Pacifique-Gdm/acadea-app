import type { AllocationRow } from "./feeAllocationView";
import { allocationTotals, allocationFinancialTotals, unavailableAllocation } from "./feeAllocationView";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable } from "./pdf";
import { formatCurrencyMoney } from "./currency";

/** The exported rows are the exact projection displayed by the authorized drawer. */
export function feeAllocationPdfSections(rows: AllocationRow[], filterLabel: string, context: string) {
  const operational = rows.some(r => r.financial);
  const amount = (currency: "CDF" | "USD", field: "receivedMinor" | "spentMinor" | "availableMinor") => {
    const value = allocationFinancialTotals(rows, field).find(t => t.currency === currency)?.value;
    return value === null || value === undefined ? unavailableAllocation : formatCurrencyMoney(value / 100, currency);
  };
  return [pdfInfoGrid([{ label: "Contexte", value: context }, { label: "Filtre", value: filterLabel },
    { label: "Statut", value: operational ? "Registre rapproché — recette fictive uniquement" : "Préparatoire — aucune activation financière" }]),
  pdfSection("Synthèse", `<p>Prévu : un tarif de référence par classe configurée, sans multiplication par les effectifs ni prise en compte des réductions individuelles. Ce n'est pas un solde disponible.</p>${pdfTable([
    { header: "Devise", render: (row) => row.currency }, { header: "Prévu", render: (row) => formatCurrencyMoney(row.amountMinor / 100, row.currency) },
    { header: "Encaissé", render: row => amount(row.currency, "receivedMinor") }, { header: "Dépensé", render: row => amount(row.currency, "spentMinor") }, { header: "Disponible", render: row => amount(row.currency, "availableMinor") },
  ], allocationTotals(rows), "Aucun tarif configuré dans cette vue.")}`),
  pdfSection("Situation des répartitions", pdfTable<AllocationRow>([
    { header: "Rubrique / origine", render: (row) => `${row.rubricName} · ${row.schoolName} · ${row.feeName} · ${row.classLabel} · ${row.yearName} · brouillon v${row.config.draftRevision}${row.stale ? " · tarif à revérifier" : ""}` },
    { header: "Prévu", render: (row) => formatCurrencyMoney(row.amountMinor / 100, row.currency), align: "right" },
    ...(["receivedMinor", "spentMinor", "availableMinor"] as const).map((field, i) => ({ header: ["Encaissé", "Dépensé", "Disponible"][i], render: (row: AllocationRow) => row.financial ? formatCurrencyMoney(row.financial[field] / 100, row.currency) : "Non disponible" })),
  ], rows, "Aucune répartition préparée pour ce filtre.")),
  `<p>${escapePdfHtml(operational ? "Encaissements selon le filtre. Dépenses et disponible restent globaux à la rubrique commune, sans attribution fictive à un frais ou une classe. Disponible : cumul à la fin de période, ouverture incluse, pas seulement sa variation. Non affecté conserve les recettes scolaires sans configuration et les reliquats ; dons exclus."
    : "Non affecté représente ici le reliquat prévisionnel de chaque tarif, pas une réserve de trésorerie créditée. Aucun mouvement, arriéré encaissé ou solde d'ouverture n'est intégré en phase 2.")}</p>`];
}
