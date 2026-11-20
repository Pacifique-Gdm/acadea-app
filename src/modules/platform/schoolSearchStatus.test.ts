import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { schoolCountLabel, SLOW_SCHOOL_SEARCH_MS } from "./schoolSearchStatus";

// Version 1.16.5 : « 29 écoles » sans « recherche… » collé, et aucune relance de la recherche à l'ouverture d'une école.
const platform = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./useSchoolSearch.ts", import.meta.url), "utf8");
const body = (name: string) => {
  const start = platform.indexOf(`function ${name}(`);
  const next = platform.indexOf("\n  }\n", start);
  return platform.slice(start, next);
};

describe("compteur de l'onglet Écoles", () => {
  it("singulier et pluriel corrects", () => {
    expect(schoolCountLabel(0)).toBe("0 école");
    expect(schoolCountLabel(1)).toBe("1 école");
    expect(schoolCountLabel(29)).toBe("29 écoles");
  });

  it("plus de « recherche… » : un petit indicateur seulement après une seconde", () => {
    expect(platform).not.toContain("recherche…");
    expect(platform).toContain("{schoolCountLabel(serverSearch.total)}{searchIsSlow &&");
    expect(SLOW_SCHOOL_SEARCH_MS).toBe(1000);
  });

  it("ouvrir une école ne relance pas la recherche", () => {
    // Ancien code : un effet comparait les écoles connues et relançait la recherche quand une école lue
    // apparaissait (école récente) ou disparaissait (quota écrit depuis une copie ancienne des données).
    expect(platform).not.toContain("if (changed) refreshServerSearch();");
    for (const name of ["openSchoolDrawer", "loadSchoolDrawerData", "mergeKnownSchools", "refreshSchoolQuota"]) {
      expect(body(name)).not.toContain("refreshServerSearch");
    }
    // Le quota et la fusion partent des dernières données : l'école tout juste lue reste connue.
    expect(body("refreshSchoolQuota")).toContain("latestDataRef.current.schools.map(");
    expect(body("refreshSchoolQuota")).not.toContain("data.schools.map(");
    expect(body("mergeKnownSchools")).toContain("const current = latestDataRef.current;");
  });

  it("relance la recherche seulement après une création, une modification ou une suppression", () => {
    for (const name of ["createSchool", "changeSchoolStatus", "saveSchoolInformation", "saveSchoolAcronym", "deleteSchool"]) {
      expect(body(name)).toContain("refreshServerSearch();");
    }
    expect(hook).toContain("fresh: true");
  });

  it("un onglet quitté pendant la recherche ne laisse pas l'indicateur bloqué", () => {
    expect(hook).toContain("if (!enabled || done.current === signature) { setLoading(false); return undefined; }");
  });
});
