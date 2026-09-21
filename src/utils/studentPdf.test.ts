import { describe, expect, it } from "vitest";
import { sortStudentsAlphabeticallyForPdf } from "./studentPdf";

describe("ordre des élèves dans les PDF", () => {
  it("utilise le même ordre nom, postnom, prénom que la pagination UI", () => {
    const students = [
      { id: "3", nom: "Zulu", postnom: "", prenom: "A" },
      { id: "2", nom: "Alpha", postnom: "B", prenom: "A" },
      { id: "1", nom: "Alpha", postnom: "A", prenom: "B" },
    ];
    expect(sortStudentsAlphabeticallyForPdf(students).map((student) => student.id)).toEqual(["1", "2", "3"]);
  });
});
