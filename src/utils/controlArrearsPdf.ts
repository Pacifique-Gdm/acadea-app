import type { Student } from "../types";
import type { HistoricalDebt } from "../services/financialTransactions";
import { formatCurrencyMoney } from "./currency";
import { pdfSection, pdfTable } from "./pdf";

type ArrearsStudent = Pick<Student, "id" | "nom" | "postnom" | "prenom" | "matricule">;

export function controlArrearsPdfSections(students: ArrearsStudent[], details: Record<string, HistoricalDebt[]>, currency: "USD" | "CDF") {
  const summary = students.map((student) => ({
    student,
    total: (details[student.id] ?? []).filter((debt) => debt.currency === currency).reduce((sum, debt) => sum + debt.remaining, 0),
  }));
  const debts = students.flatMap((student) => (details[student.id] ?? [])
    .filter((debt) => debt.currency === currency && debt.remaining > 0)
    .map((debt) => ({ student, debt })));
  return [
    pdfSection("Total des arriérés par élève", pdfTable([
      { header: "Élève", render: ({ student }) => `${student.nom} ${student.postnom} ${student.prenom}`.trim() },
      { header: "Matricule", render: ({ student }) => student.matricule },
      { header: "Total restant", render: ({ total }) => formatCurrencyMoney(total, currency), align: "right" },
    ], summary, "Aucun élève ne correspond au critère.")),
    pdfSection("Détail des dettes historiques impayées", pdfTable([
      { header: "Élève", render: ({ student }) => `${student.nom} ${student.prenom}`.trim() },
      { header: "Année d'origine", render: ({ debt }) => debt.yearName },
      { header: "Frais", render: ({ debt }) => debt.feeName },
      { header: "Attendu", render: ({ debt }) => formatCurrencyMoney(debt.expected, currency), align: "right" },
      { header: "Payé", render: ({ debt }) => formatCurrencyMoney(debt.paid, currency), align: "right" },
      { header: "Restant", render: ({ debt }) => formatCurrencyMoney(debt.remaining, currency), align: "right" },
    ], debts, "Aucune dette historique impayée pour ces élèves.")),
  ];
}
