import { describe, expect, it } from "vitest";
import { deleteStudentBirthDateInput, formatStudentBirthDateInput, guideStudentBirthDateInput, parseStudentBirthDateInput } from "./studentBirthDate";

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
  it.each([["1", "1"], ["15", "15/"], ["150", "15/0"], ["1508", "15/08/"], ["15082014", "15/08/2014"], ["1508201499", "15/08/2014"]])("guide les chiffres %s", (input, visible) => {
    expect(guideStudentBirthDateInput(input)).toBe(visible);
  });
  it.each([" 15 08 2014 ", "15 /08/2014", "15-08-2014", "15.08.2014", "15a082014", "15,08,2014"]) ("filtre le collage %s sans conserver les caractères interdits", (input) => {
    expect(guideStudentBirthDateInput(input)).toBe("15/08/2014");
  });
  it("ne transforme pas des lettres en date", () => expect(guideStudentBirthDateInput("abc !")).toBe(""));
  it.each([" 15/08/2014", "15/08/2014 ", "15 /08/2014", " ", "1", "15/", "15/0", "15/08/", "15/08/20", "31/02/2015", "30/02/2015", "00/12/2015", "15/00/2015", "15/13/2015", "29/02/2023"]) ("refuse toute valeur invalide ou incomplète %s", (input) => {
    expect(parseStudentBirthDateInput(input)).toBeNull();
  });
  it.each([["15/08/2014", "2014-08-15"], ["29/02/2024", "2024-02-29"]])("valide la date réelle %s", (input, stored) => expect(parseStudentBirthDateInput(input)).toBe(stored));
  it("efface les chiffres aux frontières des séparateurs sans rester bloqué", () => {
    let value = "15/08/2014";
    for (const expected of ["15/08/201", "15/08/20", "15/08/2", "15/08/", "15/0", "15/", "1", ""]) {
      value = deleteStudentBirthDateInput(value, value.length, value.length, true).value;
      expect(value).toBe(expected);
    }
    expect(guideStudentBirthDateInput("15082014")).toBe("15/08/2014");
  });
  it("conserve les chiffres hors sélection et replace le curseur", () => {
    expect(deleteStudentBirthDateInput("15/08/2014", 3, 5, true)).toEqual({ value: "15/20/14", caret: 3 });
    expect(deleteStudentBirthDateInput("15/08/2014", 0, 0, false)).toEqual({ value: "50/82/014", caret: 0 });
  });
});
