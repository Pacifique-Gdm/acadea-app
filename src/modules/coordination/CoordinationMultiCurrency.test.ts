import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const menu = read("./CoordinationMenu.tsx");
const dashboard = read("./CoordinationDashboard.tsx");
const dashboardPdf = read("./coordinationDashboardPdf.ts");
const financialExports = read("./coordinationFinancialExports.ts");
const stats = read("../../utils/coordinationDashboardStats.ts");
const helper = read("../../utils/coordinationFinancialsByCurrency.ts");
const readModel = read("../../services/coordinationReadModel.ts");
const adminDashboard = read("../dashboard/Dashboard.tsx");

describe("représentation multi-devise de la Coordination", () => {
  it("réutilise une seule agrégation canonique dans le Dashboard et les Drawers", () => {
    expect(stats).toContain("groupCoordinationFinancialsByCurrency");
    expect(menu).toContain("groupCoordinationFinancialsByCurrency");
    expect(helper).toContain("currencyOrder");
    expect(helper).not.toContain('["USD", "CDF"]');
  });

  it("sépare synthèse, frais, paiements et dépenses par devise à l'écran et dans les PDF", () => {
    for (const label of ["Synthèse financière —", "Types de frais —", "Paiements —", "Dépenses —"]) expect(menu).toContain(label);
    for (const label of ["Synthèse financière —", "Types de frais —", "Répartition des montants —"]) expect(dashboardPdf).toContain(label);
    expect(financialExports).toContain("`Paiements — ${currency}`");
    expect(financialExports).toContain("`Dépenses — ${currency}`");
    expect(menu).not.toContain("financialByCurrency");
  });

  it("conserve une barre, un diagramme et un graphique journalier distincts par devise", () => {
    expect(dashboard).toContain("financial.feeProgressRows.map");
    expect(dashboard).toContain("FinancialFeeShareChart");
    expect(dashboard).toContain("chartGroups.map");
    expect(dashboard).toContain("currencySchoolIds");
  });

  it("charge les données une fois par collection puis agrège localement", () => {
    expect(readModel).toContain('loadBySchools<Student>("students", schoolIds)');
    expect(readModel).toContain("Promise.all");
    expect(readModel).not.toContain("loadByCurrency");
  });

  it("respecte le périmètre école, l'année active et le Sous-coordinateur", () => {
    expect(menu).toContain("scopedSchools");
    expect(menu).toContain("activeYearBySchool");
    expect(menu).toContain("inActiveSchoolYear");
    expect(menu).toContain("user.subCoordinationId");
  });

  it("ne modifie pas le Dashboard Administrateur", () => {
    expect(adminDashboard).not.toContain("groupCoordinationFinancialsByCurrency");
    expect(adminDashboard).not.toContain("Synthèse financière —");
  });
});
