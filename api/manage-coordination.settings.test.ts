import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./manage-coordination.js", import.meta.url), "utf8");

describe("Paramètres Coordination sécurisés", () => {
  it("réserve la mise à jour à l'acteur Coordinateur actif et audite l'opération", () => {
    expect(source).toContain('action === "update-settings"');
    expect(source).toContain("requireActiveCoordinator");
    expect(source).toContain('coordination.settings_updated');
    expect(source).toContain("batch.update(coordinationRef");
  });
});
