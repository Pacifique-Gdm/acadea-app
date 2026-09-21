import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { School } from "../../types";
import { SchoolAcronymEditDrawer } from "./SchoolAcronymEditDrawer";

const school = { id: "school-a", name: "École A", acronym: "CSL", status: "active", activeSchoolYearId: "year-a" } as School;

describe("drawer de modification du sigle", () => {
  it("explique l'impact, demande la phrase exacte et désactive la confirmation par défaut", () => {
    const html = renderToStaticMarkup(createElement(SchoolAcronymEditDrawer, {
      school, saving: false, error: "", onClose: vi.fn(), onSave: vi.fn(),
    }));
    expect(html).toContain("Modifier le sigle");
    expect(html).toContain("MODIFIER LE SIGLE");
    expect(html).toContain("Les adresses des comptes existants resteront inchangées");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirmer<\/button>/);
    expect(html).toContain("grid grid-cols-2 gap-2");
  });
});
