import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHOOL_SEARCH_DELAY_MS } from "./useSchoolSearch";

// Lot SA-2a : l'onglet « Écoles » du Super administrateur utilise la recherche faite par le serveur.
const platform = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./useSchoolSearch.ts", import.meta.url), "utf8");

describe("onglet Écoles sur la recherche du serveur", () => {
  it("affiche les écoles trouvées par le serveur, et la recherche locale seulement si la liste n'est pas prête", () => {
    expect(platform).toContain("const serverSearch = useServerSchoolSearch({ query: search, status: statusFilter, schoolType: typeFilter, sort: sortBy }, platformView === \"students\");");
    expect(platform).toContain("?? filteredSchools;");
    expect(platform).toContain("{listedSchools.map((school) => (");
    expect(hook).toContain("if (cause instanceof SchoolSearchUnavailableError) { setSchools(null); return; }");
  });
  it("pages de 25 avec « Voir plus », une seule demande par mot tapé d'un trait", () => {
    expect(platform).toContain("Voir plus (");
    expect(SCHOOL_SEARCH_DELAY_MS).toBe(300);
  });
  it("relit la liste après une création, une modification ou une suppression d'école", () => {
    expect(platform).toContain("if (changed) refreshServerSearch();");
    expect(hook).toContain("fresh: true");
  });
});
