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
    expect(dashboard).toContain("formatCurrencyMoney");
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

  it("place le titre et sa description avant la barre responsive complète", () => {
    const heading = dashboard.indexOf('data-testid="coordination-dashboard-heading"');
    const title = dashboard.indexOf(">Dashboard</h1>", heading);
    const description = dashboard.indexOf("Statistiques limitées aux années actives alignées", title);
    const actions = dashboard.indexOf('data-testid="coordination-dashboard-actions"');
    expect(heading).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(heading);
    expect(description).toBeGreaterThan(title);
    expect(actions).toBeGreaterThan(description);
    expect(dashboard).not.toContain("lg:flex-row lg:items-end lg:justify-between");
    expect(dashboard).toContain("grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-");
    for (const control of ["Filtrer par école", "Filtrer par section", "Date de début", "Date de fin", "Réinitialiser", "Exporter PDF"]) {
      expect(dashboard).toContain(control);
    }
  });

  it("charge un seul modèle paginé par lots, sans listener par carte", () => {
    expect(dashboard).not.toContain("loadCoordinationDashboardReadModel");
    expect(portal.match(/loadCoordinationDashboardReadModel/g)).toHaveLength(2);
    expect(readModel).toContain("index += 30");
    expect(readModel).toContain("limit(500)");
    expect(readModel).toContain("startAfter(cursor)");
    expect(readModel).toContain('loadBySchools<Student>("students"');
    expect(dashboard).not.toContain("onSnapshot");
  });

  it("exporte la vue avec identité Coordination et contexte école", () => {
    expect(pdf).toContain("coordinationPdfInstitution(coordination, contextSchool)");
    expect(pdf).toContain('selectedSchoolId ? contextSchool.name : "Toutes les écoles"');
    for (const section of ["Indicateurs", "Synthèse financière", "Types de frais", "Répartition des montants", "Transactions du jour", "Élèves par classe"]) expect(pdf).toContain(section);
  });

  it("rend les cartes multi-devises sur des lignes distinctes et un graphique par devise", () => {
    expect(dashboard).toContain('className="grid gap-1 text-xl"');
    expect(dashboard).toContain("stats.financialGroups.map");
    expect(dashboard).toContain("chartGroups.map");
    expect(dashboard).not.toContain('.join(" · ")');
  });
});
