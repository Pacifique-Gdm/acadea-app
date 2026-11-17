import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addChangelogEntry, checkRelease, nextVersion, releaseTypeBetween } from "../../scripts/release/versioning.mjs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("procédure de version commune à tous les agents", () => {
  it("augmente le bon chiffre selon le type du lot", () => {
    expect(nextVersion("1.4.2", "correction")).toBe("1.4.3");
    expect(nextVersion("1.4.2", "fonctionnalite")).toBe("1.5.0");
    expect(nextVersion("1.4.2", "majeur")).toBe("2.0.0");
    expect(releaseTypeBetween("1.4.2", "1.5.0")).toBe("fonctionnalite");
    expect(() => nextVersion("1.4", "correction")).toThrow("invalide");
  });
  it("le contrôle refuse une PR sans numéro augmenté ou sans liste des changements", () => {
    const changelog = addChangelogEntry("# Liste\n\n## [1.0.0] — 2026-11-17 — Version de départ\n- Départ\n", { version: "1.1.0", type: "fonctionnalite", date: "2026-11-18", changes: ["Répartition jamais bloquante"] });
    expect(checkRelease({ baseVersion: "1.0.0", headVersion: "1.1.0", changelog })).toMatchObject({ ok: true, type: "fonctionnalite" });
    expect(checkRelease({ baseVersion: "1.0.0", headVersion: "1.0.0", changelog }).problems[0]).toContain("n'a pas été augmenté");
    expect(checkRelease({ baseVersion: "1.0.0", headVersion: "1.3.0", changelog }).ok).toBe(false);
    expect(checkRelease({ baseVersion: "1.0.0", headVersion: "1.0.1", changelog }).problems.join(" ")).toContain("ne contient pas la section");
    expect(checkRelease({ baseVersion: "1.0.0", headVersion: "1.1.0", changelog: changelog.replace("- Répartition jamais bloquante", "") }).problems.join(" ")).toContain("aucun changement");
  });
  it("la nouvelle section s'ajoute en tête, sans doublon", () => {
    const base = "# Liste\n\n## [1.0.0] — 2026-11-17 — Version de départ\n- Départ\n";
    const next = addChangelogEntry(base, { version: "1.0.1", type: "correction", date: "2026-11-18", changes: ["Correctif"] });
    expect(next.indexOf("## [1.0.1]")).toBeLessThan(next.indexOf("## [1.0.0]"));
    expect(() => addChangelogEntry(next, { version: "1.0.1", type: "correction", date: "2026-11-18", changes: ["Encore"] })).toThrow("déjà");
  });
  it("la règle est écrite pour chaque agent et la procédure est dans le dépôt", () => {
    for (const file of ["../../AGENTS.md", "../../CLAUDE.md"]) {
      const text = read(file);
      expect(text).toContain("scripts/release/version-bump.mjs");
      expect(text).toContain("scripts/release/ship-lot.sh");
    }
    expect(read("../../.github/workflows/version-check.yml")).toContain("scripts/release/check-version.mjs");
    expect(read("../../scripts/release/ship-lot.sh")).toContain("version-check");
    expect(read("../../CHANGELOG.md")).toMatch(/## \[\d+\.\d+\.\d+\]/);
  });
});
