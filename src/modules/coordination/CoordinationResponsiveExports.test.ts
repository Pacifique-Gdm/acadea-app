import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const students = readFileSync(new URL("./CoordinationStudents.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("./CoordinationControl.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("./CoordinationMenu.tsx", import.meta.url), "utf8");
const subCoordinations = readFileSync(new URL("./SubCoordinationManagement.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../../components/ui/AdminDrawer.tsx", import.meta.url), "utf8");

describe("responsive et exports Coordination", () => {
  it("retire les téléchargements financiers globaux et conserve Exporter PDF dans Élèves et Contrôle", () => {
    for (const source of [students, control]) {
      expect(source).not.toContain("Télécharger les paiements PDF");
      expect(source).not.toContain("Télécharger les dépenses PDF");
      expect(source).not.toContain("exportCoordinationFinancialTransactions");
      expect(source).toContain("Exporter PDF");
      expect(source).not.toContain("createPaymentTransaction");
      expect(source).not.toContain("createExpenseTransaction");
    }
  });

  it("conserve les PDF individuels et résout l’école source sans fallback Coordination", () => {
    expect(control).toContain("resolveFinancialOperationSchool(operation, schoolsById)");
    expect(control).toContain("generateReceiptPdf(payment, student, feeType, school");
    expect(control).toContain("generateExpensePdf(expense, school, year");
    expect(control).toContain("MISSING_FINANCIAL_OPERATION_SCHOOL_ERROR");
    expect(control).toContain('headers={["Élève", "École", "Montant", "Date", "PDF"]}');
    expect(control).toContain('headers={["École", "Catégorie", "Description", "Montant", "Date", "PDF"]}');
  });

  it("empile les commandes mobiles et réserve les colonnes denses au très grand écran", () => {
    expect(students).toContain("grid-cols-1 items-stretch gap-2 sm:grid-cols-2 xl:grid-cols-");
    expect(control).toContain("grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-");
    expect(control).not.toContain("lg:flex lg:flex-nowrap");
  });

  it("utilise la variante large pour les tableaux sans élargir les formulaires simples", () => {
    expect(drawer).toContain('width?: "default" | "wide"');
    expect(menu).toContain('width={drawer === "settings" ? "default" : "wide"}');
    expect(menu).toContain('<AdminDrawer width="wide" title={`Personnel');
    expect(control).toContain('<AdminDrawer width="wide" title="Historique du contrôle"');
    expect(subCoordinations).toContain('<AdminDrawer title="Créer sous-coordination"');
  });

  it("garde les tableaux dans leur propre zone de défilement et les formulaires mobiles sur une colonne", () => {
    expect(menu).toContain('className="max-w-full overflow-x-auto"');
    expect(control).toContain('className="max-w-full overflow-x-auto"');
    expect(menu).toContain('className="grid gap-2 sm:grid-cols-2"');
    expect(subCoordinations).toContain('className="grid grid-cols-1 gap-2 sm:grid-cols-2"');
    expect(subCoordinations).toContain("min-w-0 break-words");
  });

  it("retire la phrase Super Administrateur des paramètres et filtre ses audits de la vue Coordination", () => {
    expect(menu).not.toContain("Le rattachement des écoles reste réservé au Super Administrateur.");
    expect(menu).toContain("!isSuperAdministratorAuditLog(item)");
  });
});
