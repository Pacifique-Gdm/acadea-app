import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./CoordinationDashboard.tsx", import.meta.url), "utf8");
const adminDashboard = readFileSync(new URL("../dashboard/Dashboard.tsx", import.meta.url), "utf8");
const portal = readFileSync(new URL("./CoordinationPortal.tsx", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../../services/coordinationReadModel.ts", import.meta.url), "utf8");
const pdf = readFileSync(new URL("./coordinationDashboardPdf.ts", import.meta.url), "utf8");

describe("alignement du Dashboard Coordination", () => {
  it("reprend les neuf cartes Administrateur dans l'ordre exact", () => {
    const labels = ["Nombre total d'élèves", "Nombre de classes", "Nombre total de parents", "Administrateurs", "Caissiers", "Directeurs de Discipline", "Montant attendu", "Montant total encaissé", "Montant restant à payer"];
    let cursor = -1;
    labels.forEach((label) => {
      const next = dashboard.indexOf(`label: "${label}"`);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    });
  });

  it("réutilise les graphiques et helpers du Dashboard Administrateur", () => {
    expect(dashboard).toContain("FinancialFeeShareChart");
    expect(dashboard).toContain("TransactionComboChart");
    expect(dashboard).toContain("buildDashboardTransactionDayRows");
    expect(dashboard).toContain("buildCoordinationDashboardStats");
  });

  it("conserve dans les deux vues les mêmes blocs et la grille responsive des cartes", () => {
    for (const label of ["KPI financier", "Transactions du jour"]) {
      expect(adminDashboard).toContain(label);
      expect(dashboard).toContain(label);
    }
    expect(adminDashboard).toContain("Mouvement des transactions par jour");
    expect(dashboard).toContain("<TransactionComboChart");
    expect(adminDashboard).toContain("buildDashboardClassRows(filteredStudents)");
    expect(dashboard).toContain("stats.classRows.map");
    expect(adminDashboard).toContain('className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"');
    expect(dashboard).toContain('className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"');
    expect(dashboard).toContain('className="mt-3 overflow-x-auto"');
  });

  it("expose tous les blocs, périodes, reset et filtre école attendus", () => {
    for (const label of ["KPI financier", "Recouvrement selon les filtres sélectionnés.", "Transactions du jour", "Élèves par classe", "Réinitialiser", "Exporter PDF", "Toutes les écoles", "Toutes mes écoles"]) expect(dashboard).toContain(label);
    expect(dashboard).toContain("transactionPeriod");
    expect(dashboard).toContain("onSchoolChange(\"\")");
    expect(portal).toContain("<CoordinationDashboard");
  });

  it("charge un seul modèle paginé par lots, sans listener par carte", () => {
    expect(dashboard.match(/loadCoordinationDashboardReadModel/g)).toHaveLength(2);
    expect(readModel).toContain("index += 30");
    expect(readModel).toContain("limit(500)");
    expect(readModel).toContain("startAfter(cursor)");
    expect(readModel).toContain('loadBySchools<Student>("students"');
    expect(dashboard).not.toContain("onSnapshot");
  });

  it("exporte la vue avec identité Coordination et contexte école", () => {
    expect(pdf).toContain("coordinationPdfInstitution(coordination, contextSchool)");
    expect(pdf).toContain('selectedSchoolId ? contextSchool.name : "Toutes les écoles"');
    for (const section of ["Indicateurs", "KPI financier", "Types de frais", "Répartition des montants", "Transactions du jour", "Élèves par classe"]) expect(pdf).toContain(section);
  });
});
