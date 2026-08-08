import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildControlClassChoices, buildControlFeeGroups, feeNamesForControlClass, feeNamesForWarningClass, getControlClassKey, selectPaymentWarningRecipients } from "./controlFilters";
import type { FeeType, ParentProfile, Payment, Student } from "../types";

const student = (id: string, className: Student["className"], option = ""): Student => ({ id, schoolId: "school-a", schoolYearId: "year-a", matricule: id, nom: id, postnom: "", prenom: "", sexe: "M", birthDate: "2010-01-01", address: "", phone: "", className, option, parentId: "parent-a", status: "ACTIVE" });
const fee = (id: string, name: FeeType["name"], className: FeeType["className"], classOptionKey?: string): FeeType => ({ id, schoolId: "school-a", schoolYearId: "year-a", name, amount: 100, className, classOptionKey });

describe("filtres du Contrôle", () => {
  it("construit les classes sans doublon", () => {
    const students = [student("a", "1ère Primaire"), student("b", "1ère Primaire"), student("c", "1ère Humanité", "Sciences")];
    expect(buildControlClassChoices(students)).toHaveLength(2);
  });

  it("filtre les types de frais selon la classe et l'option", () => {
    const selected = student("a", "1ère Humanité", "Sciences");
    const fees = [fee("science", "Minerval", "1ère Humanité", getControlClassKey(selected)), fee("literature", "Transport", "1ère Humanité", "1ère Humanité::option::Littéraire")];
    expect(feeNamesForControlClass(fees, selected)).toEqual(["Minerval"]);
    expect(feeNamesForControlClass(fees)).toEqual([]);
    expect(feeNamesForWarningClass(fees, "all")).toEqual(["Minerval", "Transport"]);
    expect(buildControlFeeGroups(fees, getControlClassKey(selected), selected).map((group) => group.name)).toEqual(["Minerval"]);
    expect(buildControlFeeGroups(fees, "all").map((group) => group.name)).toEqual(["Minerval", "Transport"]);
  });

  it("regroupe les frais applicables d'une classe sans exposer ceux d'une autre classe", () => {
    const selected = student("a", "1ère Primaire");
    const fees = [
      fee("shared", "Frais scolaires", undefined),
      fee("primary-one", "Minerval", "1ère Primaire"),
      fee("primary-two", "Transport", "2ème Primaire"),
    ];

    expect(buildControlFeeGroups(fees, getControlClassKey(selected), selected).map((group) => group.name)).toEqual([
      "Frais scolaires",
      "Minerval",
    ]);
  });

  it("cible les parents par frais, classe, école et année sans doublon", () => {
    const students = [
      { ...student("a", "1ère Primaire"), parentId: "parent-a" },
      { ...student("b", "1ère Primaire"), parentId: "parent-a" },
      { ...student("c", "2ème Primaire"), parentId: "parent-b" },
      { ...student("other-school", "1ère Primaire"), schoolId: "school-b", parentId: "parent-c" },
    ];
    const parents: ParentProfile[] = [
      { id: "parent-a", schoolId: "school-a", schoolYearId: "year-a", userId: "user-a", fullName: "A", phone: "", email: "", address: "", studentIds: ["a", "b"], status: "active" },
      { id: "parent-b", schoolId: "school-a", schoolYearId: "year-a", userId: "user-b", fullName: "B", phone: "", email: "", address: "", studentIds: ["c"], status: "active" },
      { id: "parent-c", schoolId: "school-b", schoolYearId: "year-a", userId: "user-c", fullName: "C", phone: "", email: "", address: "", studentIds: ["other-school"], status: "active" },
    ];
    const fees = [fee("primary-one", "Minerval", "1ère Primaire"), fee("primary-two", "Transport", "2ème Primaire")];
    const payments: Payment[] = [];

    const allClasses = selectPaymentWarningRecipients({ students, parents, feeTypes: fees, payments, schoolId: "school-a", schoolYearId: "year-a", classKey: "all", feeName: "Minerval", requiredAmount: 100 });
    expect(allClasses).toHaveLength(1);
    expect(allClasses[0].parent.id).toBe("parent-a");
    expect(allClasses[0].students.map((item) => item.id)).toEqual(["a", "b"]);

    const exactClass = selectPaymentWarningRecipients({ students, parents, feeTypes: fees, payments, schoolId: "school-a", schoolYearId: "year-a", classKey: "2ème Primaire", feeName: "Transport", requiredAmount: 100 });
    expect(exactClass.map((item) => item.parent.id)).toEqual(["parent-b"]);
  });

  it("exclut les comptes inactifs, les années différentes et les frais déjà réglés", () => {
    const students = [
      { ...student("paid", "1ère Primaire"), parentId: "parent-paid" },
      { ...student("inactive", "1ère Primaire"), parentId: "parent-inactive" },
      { ...student("other-year", "1ère Primaire"), schoolYearId: "year-b", parentId: "parent-other-year" },
    ];
    const parents: ParentProfile[] = [
      { id: "parent-paid", schoolId: "school-a", schoolYearId: "year-a", userId: "user-paid", fullName: "Payé", phone: "", email: "", address: "", studentIds: ["paid"], status: "active" },
      { id: "parent-inactive", schoolId: "school-a", schoolYearId: "year-a", userId: "user-inactive", fullName: "Inactif", phone: "", email: "", address: "", studentIds: ["inactive"], status: "inactive" },
      { id: "parent-other-year", schoolId: "school-a", schoolYearId: "year-b", userId: "user-other-year", fullName: "Autre année", phone: "", email: "", address: "", studentIds: ["other-year"], status: "active" },
    ];
    const fees = [fee("minerval", "Minerval", "1ère Primaire")];
    const payments: Payment[] = [{ id: "payment", schoolId: "school-a", schoolYearId: "year-a", studentId: "paid", parentId: "parent-paid", feeTypeId: "minerval", amount: 100, paidAt: "2026-01-01", cashierName: "Caissier" }];

    expect(selectPaymentWarningRecipients({ students, parents, feeTypes: fees, payments, schoolId: "school-a", schoolYearId: "year-a", classKey: "all", feeName: "Minerval", requiredAmount: 100 })).toEqual([]);
  });

  it("conserve le filtre classe avec les autres filtres et leur réinitialisation", () => {
    const source = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");
    expect(source).toContain("getControlClassKey(row.student) !== controlClassKey");
    expect(source).toContain('setAmountComparator("")');
    expect(source).toContain('setControlClassKey("")');
    expect(source).toContain('setWarningFeeName("")');
    expect(source).toContain('<option value="" disabled hidden>Classe</option>');
    expect(source).toContain('<option value="all">Toutes</option>');
    expect(source).toContain('<select value={amountComparator}');
    expect(source).toContain('<option value="" disabled hidden>Montant payé</option>');
    expect(source).toContain('disabled={!warningFeeName}');
    expect(source).toContain('warningFeeName && !warningFeeNameChoices.includes(warningFeeName)');
    expect(source).toContain('buildControlFeeGroups(yearData.feeTypes, controlClassKey, selectedControlClassStudent)');
    expect(source).toContain('if (feeFilter && applicableFeeIds.length === 0) return false');
    expect(source).toContain('!amountComparator || amountComparator === "all" || !amountThreshold');
  });

  it("configure la barre Administrateur avec les comparateurs globaux et des actions par icône", () => {
    const source = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");
    const adminBarStart = source.indexOf('<div className="mb-3 w-full min-w-0 max-w-full">');
    const adminBar = source.slice(adminBarStart, source.indexOf('<div className="grid min-w-0 gap-3">', adminBarStart));
    const amountSelectStart = adminBar.indexOf("<select value={amountComparator}");
    const amountSelect = adminBar.slice(amountSelectStart, adminBar.indexOf("</select>", amountSelectStart));
    expect(amountSelect).not.toContain('<option value="all">Toutes</option>');
    expect(amountSelect).toContain('<option value="all-fees-gte">Tous les frais ≥</option>');
    expect(amountSelect).toContain('<option value="all-fees-lt">Tous les frais &lt;</option>');
    expect(source).toContain('row.feeSummaries.every((summary) => summary.paid >= threshold)');
    expect(source).toContain('row.feeSummaries.some((summary) => summary.paid < threshold)');
    expect(adminBar).toContain('className="pdf-export-button h-10 min-w-0 px-2 lg:flex-1 lg:basis-0"');
    expect(adminBar).toContain('<Download className="h-4 w-4" /> Exporter PDF');
    expect(adminBar).toContain('title="Réinitialiser" aria-label="Réinitialiser"');
    expect(adminBar).toContain('title="Avertissement" aria-label="Avertissement"');
    expect(adminBar).not.toContain(" /> Imprimer");
    expect(adminBar).toContain("lg:flex-nowrap");
    expect(adminBar).toContain("lg:flex-1 lg:basis-0");
    expect(adminBar).toContain('className="mb-3 w-full min-w-0 max-w-full"');
    expect(adminBar).toContain('className="grid w-full min-w-0 grid-cols-1 items-stretch gap-2 box-border sm:grid-cols-2 lg:flex lg:flex-nowrap lg:items-center lg:gap-1.5"');
  });

  it("réinitialise le timer du message de confirmation et le nettoie", () => {
    const source = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");
    expect(source).toContain("warningFeedback?.type !== \"success\"");
    expect(source).toContain("window.setTimeout(() => setWarningFeedback(null), 4000)");
    expect(source).toContain("window.clearTimeout(timer)");
  });
});
