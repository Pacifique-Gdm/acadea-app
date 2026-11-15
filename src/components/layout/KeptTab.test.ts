import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeptTab } from "./KeptTab";
import { nextVisitedTabs } from "./keptTabState";
import { nextReturnCount, sameClassRecords } from "../../modules/coordination/coordinationTabReturn";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("lot 19 : onglets gardés pendant la session", () => {
  it("un onglet est construit à sa première ouverture puis gardé (masqué, jamais reconstruit)", () => {
    let visited: readonly string[] = nextVisitedTabs<string>(["dashboard"], "dashboard");
    expect(visited).toEqual(["dashboard"]);
    visited = nextVisitedTabs(visited, "students");
    const afterReturn = nextVisitedTabs(visited, "dashboard");
    expect(afterReturn).toBe(visited); // même liste : aucun onglet recréé au retour
    expect(renderToStaticMarkup(createElement(KeptTab, { id: "students", active: "dashboard", visited, children: "Élèves" }))).toBe("<div hidden=\"\">Élèves</div>");
    expect(renderToStaticMarkup(createElement(KeptTab, { id: "students", active: "students", visited, children: "Élèves" }))).toBe("<div class=\"contents\">Élèves</div>");
    expect(renderToStaticMarkup(createElement(KeptTab, { id: "control", active: "dashboard", visited, children: "Contrôle" }))).toBe("");
  });

  it("compte seulement les vrais retours sur un onglet", () => {
    expect(nextReturnCount(0, true, true)).toBe(0); // première ouverture
    expect(nextReturnCount(0, true, false)).toBe(0); // départ
    expect(nextReturnCount(0, false, true)).toBe(1); // retour
  });

  it("la liste des classes relue au retour n'est remplacée que si elle a changé", () => {
    const a = [{ id: "c1", schoolId: "s", schoolYearId: "y", name: "1ère" }];
    expect(sameClassRecords(a, [{ ...a[0] }])).toBe(true);
    expect(sameClassRecords(a, [{ ...a[0], name: "2ème" }])).toBe(false);
  });
});

describe("portail Coordination et Sous-coordination : aller-retour sans rechargement inutile", () => {
  const portal = read("../../modules/coordination/CoordinationPortal.tsx");
  const students = read("../../modules/coordination/CoordinationStudents.tsx");
  const control = read("../../modules/coordination/useCoordinationControlPage.ts");

  it("garde en place Dashboard, Élèves, Contrôle et Message après leur première ouverture", () => {
    for (const id of ["dashboard", "students", "control", "messages"]) expect(portal).toContain(`<KeptTab id="${id}" active={tab} visited={visitedTabs}>`);
    expect(portal).not.toMatch(/\{tab === "(dashboard|students|control|messages)" && /);
  });

  it("garde l'écoute en temps réel sur tous les onglets et recharge seulement sur un vrai changement", () => {
    expect(portal).toContain("if (!db || !supervisionScope) return;");
    // L'écoute ne dépend plus de l'onglet affiché (elle n'est plus coupée en quittant le Dashboard).
    const listener = portal.slice(portal.indexOf("if (!db || !supervisionScope) return;"), portal.indexOf("}, [activeYears, loadSupervision, supervisionScope, user.role]);"));
    expect(listener).toContain("subscribeCoordinationDashboardUpdates(");
    expect(listener).not.toContain('tab !== "dashboard"');
    expect(portal).toContain("setDataVersion((value) => value + 1);");
    expect(portal).toMatch(/<CoordinationStudents [^>]*refreshToken=\{refreshToken \+ dataVersion\} active=\{tab === "students"\}/);
    expect(portal).toMatch(/<CoordinationControl [^>]*refreshToken=\{refreshToken \+ dataVersion\} active=\{tab === "control"\}/);
  });

  it("au retour : année active gardée, année passée rechargée (jamais périmée), classes relues sans effacement", () => {
    for (const source of [students, control]) {
      expect(source).toContain("const pastYearReturn = selectedYearId === COORDINATION_ACTIVE_YEAR ? 0 : returnCount;");
      expect(source).toMatch(/useSilentClassRefresh\(returnCount, (schoolIdsKey|schoolKey), (setClassRecords|setClasses)\);/);
    }
  });
});

describe("portail Super administrateur : aller-retour sans rechargement inutile", () => {
  const platform = read("../../modules/platform/PlatformModule.tsx");
  it("garde en place les onglets Coordinations et Menu (seuls à relancer des écoutes au retour)", () => {
    expect(platform).toContain('<KeptTab id="coordinations" active={platformView} visited={visitedViews}>');
    expect(platform).toContain('<KeptTab id="menu" active={platformView} visited={visitedViews}>');
    expect(platform).not.toMatch(/\{platformView === "(coordinations|menu)" && \(/);
  });
});
