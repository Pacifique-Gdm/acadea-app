import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("api/provision-school-account.js", "utf8");

describe("validation serveur des sections", () => {
  it("normalise, déduplique et valide la sélection multiple", () => {
    expect(source).toContain("export function normalizeSectionIds");
    expect(source).toContain("new Set(value.map(normalizeText)");
    expect(source).toContain("assertSectionsBelongToSchool(sectionIds");
  });
  it("persiste la liste et le premier élément legacy", () => {
    expect(source).toContain("section: sectionIds[0] ?? null, sectionIds");
    expect(source).toContain("{ section: sectionIds[0], sectionIds }");
  });
});
