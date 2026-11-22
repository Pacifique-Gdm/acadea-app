import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense, Payment, School, SchoolClassRecord, SchoolYear, Student } from "../types";
import { totalsByRecordedCurrency, formatRecordedTotals } from "./operationCurrency";

const render = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", async (importOriginal) => ({ ...(await importOriginal<typeof import("./pdf")>()), renderAcadPdfPreview: render }));

import { exportReportPdf } from "./reportPdf";
import { loadReportClassContext } from "../services/reportClassContext";

const school = { id: "school-a", name: "École fictive", currency: "USD" } as School;
const year = { id: "year-a", schoolId: "school-a", name: "2026-2027", currency: "USD" } as SchoolYear;
const base = { schoolId: "school-a", schoolYearId: "year-a", postnom: "Test", sexe: "M", birthDate: "2015-01-01", address: "", phone: "", matricule: "M" } as const;
const secondary = { ...base, id: "eleve-sec", nom: "Secondaire", prenom: "Avec option", className: "3ème Humanité", option: "Sciences",
  classId: "classe-3h", subClassId: "classe-3h-a", classOptionKey: "classe-3h::sciences" } as Student;
const primary = { ...base, id: "eleve-pri", nom: "Primaire", prenom: "Seul", className: "4ème Primaire" } as Student;
const former = { ...base, id: "ancien-1", schoolYearId: "year-old", nom: "Ancien", prenom: "Élève", className: "2ème Humanité", option: "Littéraire", status: "TRANSFERRED" } as Student;
const classes = [
  { id: "classe-3h", schoolId: "school-a", schoolYearId: "year-a", name: "3ème Humanité" },
  { id: "classe-3h-a", schoolId: "school-a", schoolYearId: "year-a", name: "3ème Humanité A", parentClassId: "classe-3h", classOptionKey: "classe-3h::sciences", subClassLabel: "A" },
] as SchoolClassRecord[];

const day = (index: number) => `2026-10-${String(1 + (index % 28)).padStart(2, "0")}`;
const payments: Payment[] = Array.from({ length: 60 }, (_, index) => {
  const isFormer = index === 59;
  const student = isFormer ? former : index % 2 ? primary : secondary;
  return { id: `paiement-${String(index).padStart(2, "0")}`, schoolId: "school-a", schoolYearId: isFormer ? "year-old" : "year-a", studentId: student.id, feeTypeId: "frais",
    paidAt: day(index), amount: 10 + index, currency: "USD", cashierName: "Caissier", receiptNumber: `REC-${String(index + 1).padStart(4, "0")}`,
    ...(isFormer ? { formerStudent: true, formerStudentId: former.id, collectionSchoolYearId: "year-a" } : {}) } as Payment;
});
const expenses: Expense[] = Array.from({ length: 30 }, (_, index) => ({ id: `depense-${String(index).padStart(2, "0")}`, schoolId: "school-a", schoolYearId: "year-a",
  spentAt: day(index), amount: 5 + index, currency: "USD", category: "Fournitures", description: `Dépense numéro ${index + 1}`, cashierName: "Caissier" }) as Expense);

function sectionHtml(title: string) {
  const sections: string[] = render.mock.calls[0]?.[0]?.sections ?? [];
  const section = sections.find((html) => html.includes(`>${title}</h2>`));
  if (!section) throw new Error(`Section ${title} introuvable`);
  return section;
}
const bodyRows = (html: string) => (html.split("<tbody>")[1]?.split("</tbody>")[0].match(/<tr>/g) ?? []).length;
const cells = (html: string) => [...(html.split("<tbody>")[1]?.split("</tbody>")[0] ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .map((row) => [...row[1].matchAll(/<span class="cell-inner">([\s\S]*?)<\/span>/g)].map((cell) => cell[1]));

describe("rapport financier PDF — toutes les lignes et colonne Classe", () => {
  beforeEach(() => render.mockClear());

  it("liste les 60 paiements et les 30 dépenses, avec des totaux égaux à la synthèse", async () => {
    const paid = totalsByRecordedCurrency(payments);
    const spent = totalsByRecordedCurrency(expenses);
    await exportReportPdf(school, year, "2026-10-01", "2026-10-31", "Toutes", false, paid, spent, null, payments, expenses,
      [secondary, primary], [], [], { CDF: 0, USD: 69 }, { classes, extraStudents: [former] });
    const paymentSection = sectionHtml("Paiements");
    const expenseSection = sectionHtml("Dépenses");
    expect(bodyRows(paymentSection)).toBe(60);
    expect(bodyRows(expenseSection)).toBe(30);
    for (const payment of payments) expect(paymentSection).toContain(payment.receiptNumber);
    for (const expense of expenses) expect(expenseSection).toContain(expense.description);
    // Somme des montants affichés ligne par ligne = total de la synthèse.
    const rowSum = (rows: string[][], amountColumn: number) => rows.reduce((total, row) => total + Number(row[amountColumn].replace(/[^\d,]/g, "").replace(",", ".")), 0);
    expect(rowSum(cells(paymentSection), 4)).toBeCloseTo(paid.USD, 2);
    expect(rowSum(cells(expenseSection), 4)).toBeCloseTo(spent.USD, 2);
    expect(paymentSection).toContain(`Total des 60 paiements</strong></td><td class="align-right"><strong>${formatRecordedTotals(paid, "USD")}`);
    expect(expenseSection).toContain(`Total des 30 dépenses</strong></td><td class="align-right"><strong>${formatRecordedTotals(spent, "USD")}`);
    expect(sectionHtml("Synthèse")).toContain(formatRecordedTotals(paid, "USD"));
  });

  it("remplit la colonne Classe : secondaire avec option et sous-classe, primaire, ancien élève", async () => {
    await exportReportPdf(school, year, "2026-10-01", "2026-10-31", "Toutes", false, totalsByRecordedCurrency(payments), totalsByRecordedCurrency(expenses), null,
      payments, expenses, [secondary, primary], [], [], { CDF: 0, USD: 69 }, { classes, extraStudents: [former] });
    const paymentSection = sectionHtml("Paiements");
    expect(paymentSection).toContain(">Classe<");
    expect(paymentSection).not.toContain(">Option<");
    const rows = cells(paymentSection);
    const classOf = (studentName: string) => new Set(rows.filter((row) => row[1].startsWith(studentName)).map((row) => row[2]));
    expect(classOf("Secondaire")).toEqual(new Set(["3ème Sciences A"]));
    expect(classOf("Primaire")).toEqual(new Set(["4ème Primaire"]));
    expect(classOf("Ancien")).toEqual(new Set(["2ème Littéraire"]));
    expect(rows.every((row) => row[2] !== "—")).toBe(true);
  });

  it("refuse un rapport dont les lignes ne correspondent pas à la synthèse (paiement d'ancien élève oublié)", async () => {
    const withoutFormer = payments.slice(0, 59);
    await expect(exportReportPdf(school, year, "2026-10-01", "2026-10-31", "Toutes", false, totalsByRecordedCurrency(payments), totalsByRecordedCurrency(expenses), null,
      withoutFormer, expenses, [secondary, primary])).rejects.toThrow("ne correspondent pas aux totaux de la synthèse");
    expect(render).not.toHaveBeenCalled();
  });

  it("charge la fiche de l'ancien élève et les classes des années concernées", async () => {
    const readStudent = vi.fn(async (id: string) => (id === former.id ? former : null));
    const readClasses = vi.fn(async (_schoolId: string, yearId: string) => classes.filter((item) => item.schoolYearId === yearId));
    const context = await loadReportClassContext({ schoolId: "school-a", schoolYearId: "year-a", students: [secondary, primary], payments }, { readStudent, readClasses });
    expect(readStudent).toHaveBeenCalledTimes(1);
    expect(context.extraStudents).toEqual([former]);
    expect(readClasses.mock.calls.map((call) => call[1]).sort()).toEqual(["year-a", "year-old"]);
    expect(context.classes).toHaveLength(2);
  });
});
