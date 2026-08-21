import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CoordinationCreateDrawer.tsx", import.meta.url), "utf8");

describe("création Coordination depuis le Menu Super Administrateur", () => {
  it("réutilise le provisioning existant dans un Drawer", () => {
    expect(source).toContain("createCoordination");
    expect(source).toContain('<AdminDrawer title="Créer Coordination"');
    expect(source).toContain("selectedSchools");
  });
});
