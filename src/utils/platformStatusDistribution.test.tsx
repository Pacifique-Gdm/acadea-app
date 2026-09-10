import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlatformStatusDistributionCard } from "../components/platform/PlatformStatusDistributionCard";
import { coordinationStatusDistribution } from "./platformStatusDistribution";
import type { Coordination } from "../types";

const coordination = (id: string, status: Coordination["status"]): Coordination => ({ id, name: id, status });

describe("répartition des statuts du Dashboard Super Administrateur", () => {
  it("compte indépendamment les statuts réels des Coordinations", () => {
    const result = coordinationStatusDistribution([
      coordination("a", "active"),
      coordination("b", "active"),
      coordination("c", "inactive"),
      coordination("d", "archived"),
    ]);
    expect(result.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "Actives", value: 2 },
      { label: "Inactives", value: 1 },
      { label: "Archivées", value: 1 },
    ]);
  });

  it("conserve les valeurs legacy dans le total sans produire NaN", () => {
    const items = coordinationStatusDistribution([coordination("legacy", "legacy" as Coordination["status"])]);
    expect(items.at(-1)).toMatchObject({ label: "Autres", value: 1 });
    const markup = renderToStaticMarkup(createElement(PlatformStatusDistributionCard, {
      title: "Répartition des Coordinations par statut",
      description: "Test",
      total: 1,
      totalLabel: "Coordination(s)",
      items,
    }));
    expect(markup).not.toContain("NaN");
    expect(markup).toContain("max-w-full");
  });

  it("rend un état vide stable et le layout responsive à deux cartes", () => {
    const empty = coordinationStatusDistribution([]);
    expect(empty.every((item) => item.value === 0)).toBe(true);
    const source = readFileSync(new URL("../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="grid min-w-0 gap-4 lg:grid-cols-2"');
    expect(source).toContain('title="Répartition des écoles par statut"');
    expect(source).toContain('title="Répartition des Coordinations par statut"');
  });
});
