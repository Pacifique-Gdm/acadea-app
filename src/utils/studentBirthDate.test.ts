import { describe, expect, it } from "vitest";
import { formatStudentBirthDateInput, parseStudentBirthDateInput } from "./studentBirthDate";

describe("date de naissance élève", () => {
  it.each([
    ["25/09/2012", "2012-09-25"],
    ["01/01/2010", "2010-01-01"],
    ["29/02/2012", "2012-02-29"],
    ["", ""],
  ])("convertit %s vers le contrat de stockage existant", (visible, stored) => {
    expect(parseStudentBirthDateInput(visible)).toBe(stored);
  });

  it.each(["29/02/2011", "31/04/2012", "32/01/2012", "00/01/2012", "01/13/2012", "25-09-2012", "texte arbitraire"])(
    "refuse la date invalide %s",
    (value) => expect(parseStudentBirthDateInput(value)).toBeNull(),
  );

  it("présente une date existante au format jj/mm/aaaa sans changer sa valeur canonique", () => {
    expect(formatStudentBirthDateInput("2012-09-25")).toBe("25/09/2012");
    expect(parseStudentBirthDateInput(formatStudentBirthDateInput("2012-09-25"))).toBe("2012-09-25");
  });
});
