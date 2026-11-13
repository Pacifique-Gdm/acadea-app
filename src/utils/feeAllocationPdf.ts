import type { AllocationRow } from "./feeAllocationView";
import { allocationTotals, unavailableAllocation } from "./feeAllocationView";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable } from "./pdf";
import { formatCurrencyMoney } from "./currency";

/** The exported rows are the exact projection displayed by the authorized drawer. */
export function feeAllocationPdfSections(rows: AllocationRow[], filterLabel: string, context: string) {
  return [pdfInfoGrid([{ label: "Contexte", value: context }, { label: "Filtre", value: filterLabel },
    { label: "Statut", value: "Préparatoire — aucune activation financière" }]),
  pdfSection("Synthèse", `<p>Prévu : un tarif de référence par classe configurée, sans multiplication par les effectifs ni prise en compte des réductions individuelles. Ce n'est pas un solde disponible.</p>${pdfTable([
    { header: "Devise", render: (row) => row.currency }, { header: "Prévu", render: (row) => formatCurrencyMoney(row.amountMinor / 100, row.currency) },
    { header: "Encaissé", render: () => unavailableAllocation }, { header: "Dépensé", render: () => unavailableAllocation }, { header: "Disponible", render: () => unavailableAllocation },
  ], allocationTotals(rows), "Aucun tarif configuré dans cette vue.")}`),
  pdfSection("Situation des répartitions", pdfTable<AllocationRow>([
    { header: "Rubrique / origine", render: (row) => `${row.rubricName} · ${row.schoolName} · ${row.feeName} · ${row.classLabel} · ${row.yearName} · brouillon v${row.config.draftRevision}${row.stale ? " · tarif à revérifier" : ""}` },
    { header: "Prévu", render: (row) => formatCurrencyMoney(row.amountMinor / 100, row.currency), align: "right" },
    { header: "Encaissé", render: () => "Non disponible" }, { header: "Dépensé", render: () => "Non disponible" }, { header: "Disponible", render: () => "Non disponible" },
  ], rows, "Aucune répartition préparée pour ce filtre.")),
  `<p>${escapePdfHtml("Non affecté représente ici le reliquat prévisionnel de chaque tarif, pas une réserve de trésorerie créditée. Aucun mouvement, arriéré encaissé ou solde d'ouverture n'est intégré en phase 2.")}</p>`];
}
