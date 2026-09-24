import { describe, expect, it } from "vitest";
import { isCanonicalSubclassLetter, nextSubclassLetters, subclassLetterAt } from "./subclassLetters.js";

describe("lettres automatiques des sous-classes", () => {
  it("propose A/B au départ, puis les prochaines lettres après A/B", () => {
    expect(nextSubclassLetters([], 2)).toEqual(["A", "B"]);
    expect(nextSubclassLetters(["A"])).toEqual(["B"]);
    expect(nextSubclassLetters(["A", "B"])).toEqual(["C"]);
    expect(nextSubclassLetters(["A", "B"], 3)).toEqual(["C", "D", "E"]);
  });

  it("comble le premier trou, y compris après une suppression, sans réutiliser une lettre active", () => {
    expect(nextSubclassLetters(["A", "B", "D"])).toEqual(["C"]);
    expect(nextSubclassLetters(["A", "C"])).toEqual(["B"]);
    expect(nextSubclassLetters(["A", "B"])).toEqual(["C"]);
    expect(nextSubclassLetters(["a ", "B", "Groupe 1"])).toEqual(["C"]);
  });

  it("continue après Z et refuse les noms libres", () => {
    expect(subclassLetterAt(25)).toBe("Z");
    expect(subclassLetterAt(26)).toBe("AA");
    expect(isCanonicalSubclassLetter("AA")).toBe(true);
    expect(isCanonicalSubclassLetter("Rouge")).toBe(false);
    expect(isCanonicalSubclassLetter("a")).toBe(false);
  });
});
