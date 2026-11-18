import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORT_ACTIVE_YEAR, supportDecisionMatchesYear } from "./socialSupportYearFilter";

const schools = [{ id: "a", activeSchoolYearId: "a-2026" }, { id: "b", activeSchoolYearId: "b-2026" }, { id: "c", activeSchoolYearId: "" }];
const drawer = readFileSync(new URL("./SocialSupportDrawer.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("../coordination/CoordinationControl.tsx", import.meta.url), "utf8");
const controlPage = readFileSync(new URL("../coordination/useCoordinationControlPage.ts", import.meta.url), "utf8");

describe("Cas sociaux : année active par défaut", () => {
  it("l'année active retient, pour chaque école, les décisions de SON année active", () => {
    expect(supportDecisionMatchesYear({ schoolId: "a", schoolYearId: "a-2026" }, SUPPORT_ACTIVE_YEAR, schools)).toBe(true);
    expect(supportDecisionMatchesYear({ schoolId: "b", schoolYearId: "b-2026" }, SUPPORT_ACTIVE_YEAR, schools)).toBe(true);
    expect(supportDecisionMatchesYear({ schoolId: "a", schoolYearId: "a-2025" }, SUPPORT_ACTIVE_YEAR, schools)).toBe(false);
    expect(supportDecisionMatchesYear({ schoolId: "a", schoolYearId: "b-2026" }, SUPPORT_ACTIVE_YEAR, schools)).toBe(false);
    expect(supportDecisionMatchesYear({ schoolId: "c", schoolYearId: "" }, SUPPORT_ACTIVE_YEAR, schools)).toBe(false);
  });
  it("« Toutes les années » et une année précise fonctionnent comme avant", () => {
    expect(supportDecisionMatchesYear({ schoolId: "a", schoolYearId: "a-2025" }, "", schools)).toBe(true);
    expect(supportDecisionMatchesYear({ schoolId: "a", schoolYearId: "a-2025" }, "a-2025", schools)).toBe(true);
    expect(supportDecisionMatchesYear({ schoolId: "a", schoolYearId: "a-2026" }, "a-2025", schools)).toBe(false);
  });
  it("le tiroir s'ouvre sur l'année active, garde « Toutes les années » et ne répète pas l'année active", () => {
    expect(drawer).toContain("useState(SUPPORT_ACTIVE_YEAR)");
    const list = drawer.slice(drawer.indexOf('aria-label="Année scolaire"'), drawer.indexOf('aria-label="Classe"'));
    expect(list.indexOf("SUPPORT_ACTIVE_YEAR")).toBeLessThan(list.indexOf("Toutes les années"));
    expect(list).toContain("y.id !== activeYearOf(y.schoolId)");
  });
});

describe("Contrôle (Coordination) : jamais « Toutes les années »", () => {
  it("la liste des années ne propose plus « Toutes les années »", () => {
    const list = control.slice(control.indexOf('aria-label="Année scolaire"'), control.indexOf("</select>", control.indexOf('aria-label="Année scolaire"')));
    expect(list).not.toContain("Toutes les années");
    expect(list).toContain("COORDINATION_ACTIVE_YEAR");
  });
  it("une année vide revient d'elle-même à l'année active", () => {
    expect(controlPage).toContain("if (!selectedYearId) setSelectedYearId(COORDINATION_ACTIVE_YEAR);");
  });
});
