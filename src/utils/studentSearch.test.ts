import { describe, expect, it } from "vitest";
import { normalizeStudentSearch, studentSearchFields } from "./studentSearch.js";

describe("index de recherche élève", () => {
  it("normalise casse, accents et espaces", () => {
    expect(normalizeStudentSearch("  ÉlÈve   KASÁÏ ")).toBe("eleve kasai");
  });

  it("indexe les préfixes des noms et toutes les sous-chaînes du matricule à partir de deux caractères", () => {
    const fields = studentSearchFields({ matricule: "ACD-26-0042", nom: "Kabuya", postnom: "Kasai", prenom: "Élise", status: "ACTIVE" });
    expect(fields.searchPrefixes).toEqual(expect.arrayContaining(["acd", "26", "004", "42", "kabu", "kas", "eli"]));
    expect(fields.searchPrefixes).not.toContain("buya");
    expect(fields.searchArchived).toBe(false);
  });

  it("retrouve un matricule complet par ses fragments internes de 2, 3 ou 4 caractères", () => {
    const fields = studentSearchFields({ matricule: "ACD-2027-583942" });
    expect(fields.searchPrefixes).toEqual(expect.arrayContaining([
      "acd-2027-583942",
      "acd",
      "2027",
      "58",
      "583",
      "839",
      "394",
      "42",
    ]));
  });

  it("borne l’index matricule à 2 017 entrées pour la longueur maximale de 64 caractères", () => {
    const matricule = Array.from({ length: 64 }, (_, index) => String.fromCharCode(0x4e00 + index)).join("");
    const fields = studentSearchFields({ matricule });
    expect(fields.searchPrefixes).toHaveLength(2017);
  });

  it("marque les dossiers archivés de façon déterministe", () => {
    expect(studentSearchFields({ status: "TRANSFERRED" }).searchArchived).toBe(true);
    expect(studentSearchFields({ status: "ACTIVE", deletedAt: "2026-01-01" }).searchArchived).toBe(true);
  });
});
