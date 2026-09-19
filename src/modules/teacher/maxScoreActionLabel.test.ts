import { describe, expect, it } from "vitest";
import { maxScoreActionLabel } from "./teacherGrading";

describe("libellé du maximum de cotation", () => {
  it("propose la première sauvegarde sans configuration persistée", () => {
    expect(maxScoreActionLabel(false)).toBe("Enregistrer maximum");
  });

  it("propose la modification dès qu'une configuration persistée est chargée", () => {
    expect(maxScoreActionLabel(true)).toBe("Modifier la côte");
  });
});
