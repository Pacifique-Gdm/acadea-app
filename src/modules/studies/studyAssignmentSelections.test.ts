import { describe, expect, it } from "vitest";
import { expandAssignmentSelections } from "./studyAssignments";

describe("sélections multiples d'affectations", () => {
  it("produit le produit matières × classes", () => {
    expect(expandAssignmentSelections(["math", "physics"], ["7a", "7b", "8a"])).toHaveLength(6);
  });

  it("élimine les doublons avant expansion", () => {
    expect(expandAssignmentSelections(["math", "math"], ["7a", "7a"])).toEqual([{ subjectId: "math", classId: "7a" }]);
  });
});
