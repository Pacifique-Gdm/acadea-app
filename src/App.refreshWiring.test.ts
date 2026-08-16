import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("actualisation des portails spécialisés", () => {
  it("ne laisse pas les portails Études et Enseignant avec un handler vide", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("onRefresh={() => undefined}");
    expect(source).toContain("refreshToken={dataRefreshToken}");
    expect(source.match(/onRefresh=\{refreshCurrentYearData\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
