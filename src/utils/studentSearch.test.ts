import { describe, expect, it } from "vitest";
import { normalizeStudentSearch, studentSearchFields } from "./studentSearch.js";

describe("index de recherche élève", () => {
  it("normalise casse, accents et espaces", () => {
    expect(normalizeStudentSearch("  ÉlÈve   KASÁÏ ")).toBe("eleve kasai");
  });

  it("indexe les préfixes utiles sans sous-chaînes arbitraires", () => {
    const fields = studentSearchFields({ matricule: "ACD-26-0042", nom: "Kabuya", postnom: "Kasai", prenom: "Élise", status: "ACTIVE" });
    expect(fields.searchPrefixes).toEqual(expect.arrayContaining(["acd", "kabu", "kas", "eli"]));
    expect(fields.searchPrefixes).not.toContain("buya");
    expect(fields.searchArchived).toBe(false);
  });

  it("marque les dossiers archivés de façon déterministe", () => {
    expect(studentSearchFields({ status: "TRANSFERRED" }).searchArchived).toBe(true);
    expect(studentSearchFields({ status: "ACTIVE", deletedAt: "2026-01-01" }).searchArchived).toBe(true);
  });
});
