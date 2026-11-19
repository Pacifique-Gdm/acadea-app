import { describe, expect, it } from "vitest";
import { compareStudentsAlphabetically, normalizeStudentSearch, studentIdentityKey, studentSearchFields } from "./studentSearch.js";

describe("index de recherche élève", () => {
  it("normalise casse, accents et espaces", () => {
    expect(normalizeStudentSearch("  ÉlÈve   KASÁÏ ")).toBe("eleve kasai");
  });

  it("compare les trois champs de l’identité complète sans tronquer les noms longs", () => {
    const key = studentIdentityKey({ nom: "  KABAMBA  ", postnom: " ILUNGA ", prenom: " Jean " });
    expect(key).toBe(studentIdentityKey({ nom: "kabamba", postnom: "ilunga", prenom: "JEAN" }));
    expect(key).not.toBe(studentIdentityKey({ nom: "kabamba", postnom: "ilunga", prenom: "Paul" }));
    expect(studentIdentityKey({ nom: "kabamba", postnom: "ilunga", prenom: "" })).toBe(studentIdentityKey({ nom: "KABAMBA", postnom: "ILUNGA", prenom: "   " }));
    expect(studentIdentityKey({ nom: "a".repeat(70) + "b", postnom: "", prenom: "" })).not.toBe(studentIdentityKey({ nom: "a".repeat(70) + "c", postnom: "", prenom: "" }));
  });

  // Lot « allègement des index des élèves » (décision du 19/11) : seulement le début et la fin du matricule.
  it("indexe les préfixes des noms, et le début et la fin du matricule (plus les morceaux du milieu)", () => {
    const fields = studentSearchFields({ matricule: "ACD-26-0042", nom: "Kabuya", postnom: "Kasai", prenom: "Élise", status: "ACTIVE" });
    expect(fields.searchPrefixes).toEqual(expect.arrayContaining(["acd", "acd-26", "acd-26-0042", "0042", "042", "42", "kabu", "kas", "eli"]));
    for (const middle of ["26", "004", "6-00", "d-2"]) expect(fields.searchPrefixes).not.toContain(middle);
    expect(fields.searchPrefixes).not.toContain("buya");
    expect(fields.searchArchived).toBe(false);
    expect(fields.sortName).toBe("kabuya kasai elise");
  });

  it("retrouve un matricule complet par son début ou sa fin, pas par un morceau du milieu", () => {
    const fields = studentSearchFields({ matricule: "ACD-2027-583942" });
    expect(fields.searchPrefixes).toEqual(expect.arrayContaining(["acd-2027-583942", "acd", "acd-2027", "583942", "3942", "942", "42"]));
    for (const middle of ["2027", "583", "839", "394"]) expect(fields.searchPrefixes).not.toContain(middle);
  });

  it("borne l’index matricule à 126 entrées pour la longueur maximale de 64 caractères (au lieu de 2 017)", () => {
    const matricule = Array.from({ length: 64 }, (_, index) => String.fromCharCode(0x4e00 + index)).join("");
    const fields = studentSearchFields({ matricule });
    expect(fields.searchPrefixes).toHaveLength(126);
  });

  it("marque les dossiers archivés de façon déterministe", () => {
    expect(studentSearchFields({ status: "TRANSFERRED" }).searchArchived).toBe(true);
    expect(studentSearchFields({ status: "ACTIVE", deletedAt: "2026-01-01" }).searchArchived).toBe(true);
  });

  it("trie par nom, postnom, prénom sans dépendre de la casse ou des accents", () => {
    const students = [
      { id: "3", nom: "Élise", postnom: "", prenom: "Chantal" },
      { id: "2", nom: "ilunga", postnom: "Mutombo", prenom: "Benoît" },
      { id: "1", nom: "ILUNGA", postnom: "Kabamba", prenom: "Alice" },
    ];
    expect(students.sort(compareStudentsAlphabetically).map((student) => student.id)).toEqual(["3", "1", "2"]);
  });
});
