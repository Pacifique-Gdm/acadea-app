import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { School, SchoolYear } from "../../types";
vi.mock("../../hooks/useResolvedExpenseCurrencies", () => ({ useResolvedExpenseCurrencies: (items: unknown[]) => items }));
import { ReportsModule } from "./ReportsModule";
describe("rapport financier : confirmation avant PDF", () => {
  const props = { yearData: { students: [], parents: [], feeTypes: [], payments: [], expenses: [] },
    school: { id: "s", name: "Fictif", currency: "USD" } as School, year: { id: "y", schoolId: "s", currency: "USD" } as SchoolYear };
  it.each([{ refreshing: true }, { refreshError: "permission-denied" }, { refreshError: "client-timeout" }])("bloque un export non confirmé %j sans effacer les chiffres", status => {
    const html = renderToStaticMarkup(createElement(ReportsModule, { ...props, ...status }));
    expect(html).toMatch(/<button disabled=""/);
    expect(html).toContain("export suspendu jusqu’à confirmation");
    expect(html).toContain("Solde net hors arriérés");
  });
  it("réautorise le PDF sur confirmation financière, indépendamment des lectures secondaires", () => {
    const html = renderToStaticMarkup(createElement(ReportsModule, props));
    expect(html).not.toMatch(/<button disabled=""/);
    expect(html).toContain("Export PDF");
  });
});
