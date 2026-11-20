import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Lot SA-2b : plus aucun chargement de toutes les écoles ni de toutes les années à l'ouverture du Super administrateur.
const service = readFileSync(new URL("../../services/superAdminData.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
const initial = service.slice(service.indexOf("export async function loadSuperAdminInitialData"), service.indexOf("/** Lot SA-2b : une école et ses années"));

describe("écoles chargées à la demande", () => {
  it("l'ouverture ne lit plus toutes les écoles ni toutes les années", () => {
    expect(initial).not.toContain('loadCollection<School>("schools")');
    expect(initial).not.toContain('loadCollection<SchoolYear>("schoolYears")');
  });
  it("une école et ses années sont lues à l'ouverture de son drawer", () => {
    expect(service).toContain('getDocs(query(collection(database, "schoolYears"), where("schoolId", "==", schoolId)))');
    expect(platform).toContain("void loadPlatformSchoolWithYears(schoolId).then(");
  });
  it("toutes les écoles seulement pour les écrans qui en ont encore besoin, une seule fois", () => {
    expect(platform).toContain('const needsAllSchools = platformView === "coordinations" || platformView === "messages" || messagingOpen');
    expect(platform).toContain("if (!needsAllSchools || allSchoolsRequested.current) return;");
  });
  it("lire une école ne relance pas la recherche (les pages affichées restent)", () => {
    expect(platform).toContain("if (changed) refreshServerSearch();");
  });
});
