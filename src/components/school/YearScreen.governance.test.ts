import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { YearScreen } from "./YearScreen";
import type { AppUser, Coordination, School } from "../../types";
vi.mock("../../firebase", () => ({ db: undefined, firebaseReady: false }));
import { isSchoolClosedByCoordination } from "../../hooks/useCoordinatedSchoolYears";

const school = { id: "school-a", activeCoordinationId: "coord-a", activeSchoolYearId: "" } as School;
const coordination: Coordination = { id: "coord-a", name: "Coordination", status: "active", yearGovernance: { operationId: "closure-a", status: "closed", years: [{ schoolId: "school-a", schoolYearId: "year-a" }], closedAt: "2026-08-30", closedBy: "coordinator" } };
function render(governance = { closed: false, loading: false, error: "" }) {
  return renderToStaticMarkup(createElement(YearScreen, { user: { id: "admin-a", role: "school_admin", schoolId: "school-a" } as AppUser, years: [], activeYearId: "", onSelect: vi.fn(), onLogout: vi.fn(), onCreate: vi.fn(), createId: () => "new-year", currency: "USD", governance }));
}
describe("sélection année Administrateur — gouvernance réelle", () => {
  it("masque formulaire et Créer seulement en clôture gouvernée", () => {
    const html = render({ closed: isSchoolClosedByCoordination(school, coordination), loading: false, error: "" });
    expect(html).toContain("Veuillez demander au Coordinateur de créer une nouvelle année scolaire.");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Créer</button>");
  });
  it("conserve le même résultat après remount depuis les données persistées", () => {
    const status = { closed: isSchoolClosedByCoordination(school, structuredClone(coordination)), loading: false, error: "" };
    expect(render(status)).toEqual(render(status));
    expect(render(status)).not.toContain("<input");
  });
  it("préserve une école indépendante même sans année active", () => {
    const independent = { ...school, activeCoordinationId: null };
    expect(isSchoolClosedByCoordination(independent, coordination)).toBe(false);
    expect(render()).toContain("<input");
    expect(render()).toContain("Créer</button>");
    expect(render()).not.toContain("Veuillez demander");
  });
  it.each(["reactivated", "superseded"] as const)("retire le message après %s", (status) => {
    const next = { ...coordination, yearGovernance: { ...coordination.yearGovernance!, status } };
    const html = render({ closed: isSchoolClosedByCoordination(school, next), loading: false, error: "" });
    expect(html).not.toContain("Veuillez demander");
    expect(html).toContain("<input");
  });
  it("ne confond pas absence d’année active, autre école et clôture Coordination", () => {
    expect(isSchoolClosedByCoordination(school, { ...coordination, yearGovernance: undefined })).toBe(false);
    expect(isSchoolClosedByCoordination({ ...school, id: "school-other" }, coordination)).toBe(false);
    expect(isSchoolClosedByCoordination(school, { ...coordination, id: "foreign" })).toBe(false);
    expect(isSchoolClosedByCoordination(school, null)).toBe(false);
  });
  it("ne montre aucun formulaire prématuré pendant la vérification ou en erreur", () => {
    expect(render({ closed: false, loading: true, error: "" })).not.toContain("<input");
    const html = render({ closed: false, loading: false, error: "Vérification indisponible" });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Veuillez demander");
  });
});
