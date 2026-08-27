import { describe, expect, it } from "vitest";
import { filterControlStudentRows } from "./controlStudentSearch";

const rows = [
  { student: { nom: "MUKENDI", postnom: "KABAMBA", prenom: "Élodie", matricule: "ELV-001" }, balance: 10 },
  { student: { nom: "ILUNGA", postnom: "MUTOMBO", prenom: "Patrick", matricule: "ELV-002" }, balance: 20 },
];

describe("recherche locale des élèves du Contrôle", () => {
  it.each([
    ["mukendi", "ELV-001"],
    ["kabamba", "ELV-001"],
    ["elodie", "ELV-001"],
    ["ELV-002", "ELV-002"],
  ])("filtre par nom, postnom, prénom ou matricule (%s)", (query, expectedMatricule) => {
    expect(filterControlStudentRows(rows, query).map(({ student }) => student.matricule)).toEqual([expectedMatricule]);
  });

  it("préserve toutes les lignes lorsque la recherche est vide", () => {
    expect(filterControlStudentRows(rows, "   ")).toBe(rows);
  });

  it("ne modifie pas les données sources", () => {
    const snapshot = structuredClone(rows);
    filterControlStudentRows(rows, "patrick");
    expect(rows).toEqual(snapshot);
  });
});
