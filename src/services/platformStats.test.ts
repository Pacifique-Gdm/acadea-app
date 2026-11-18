import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformStatusDistributionCard } from "../components/platform/PlatformStatusDistributionCard";
import { schoolStatusDistribution } from "../utils/platformStatusDistribution";
import { parsePlatformStats } from "./platformStats";

const good = {
  schools: { total: 6, active: 3, suspended: 1, pending: 0, inactive: 1 },
  students: 120, parents: 80, admins: 6,
  computedAt: "2026-11-19T10:00:00.000Z",
};

describe("lot SA-3 : chiffres du Dashboard Super administrateur", () => {
  it("accepte une réponse complète du serveur", () => {
    expect(parsePlatformStats(good)).toEqual({ ...good, schoolsComputedAt: good.computedAt });
  });

  it("refuse une réponse incomplète plutôt que d'afficher un chiffre faux", () => {
    for (const bad of [null, {}, { ...good, students: -1 }, { ...good, schools: { total: 6 } }, { ...good, computedAt: "hier" }, { ...good, admins: 1.5 }]) {
      expect(() => parsePlatformStats(bad)).toThrow("Statistiques globales incomplètes.");
    }
  });

  it("répartit les écoles d'après le serveur et range le reste dans « Autres »", () => {
    expect(schoolStatusDistribution(good.schools).map(({ label, value }) => [label, value])).toEqual([
      ["Actives", 3], ["Suspendues", 1], ["En attente", 0], ["Désactivées", 1], ["Autres", 1],
    ]);
  });

  it("affiche « en cours de chargement » au lieu de zéros tant que les chiffres ne sont pas arrivés", () => {
    const markup = renderToStaticMarkup(createElement(PlatformStatusDistributionCard, { title: "Répartition des écoles par statut", description: "Test", total: "—", totalLabel: "école(s)", items: null }));
    expect(markup).toContain("Chiffres en cours de chargement");
    expect(markup).not.toMatch(/>0</);
  });
});
