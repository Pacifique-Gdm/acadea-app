import { describe, expect, it } from "vitest";
import {
  canonicalAssignmentBlockSizes,
  canonicalSessionPattern,
  MAX_ASSIGNMENT_BLOCK_SIZE,
  validateAssignmentSessionPattern,
  weeklyPeriodsFromBlocks,
} from "./assignmentSessionPattern";
import type { PedagogicalAssignment } from "./studyTypes";

const assignment = (overrides: Partial<PedagogicalAssignment> = {}): PedagogicalAssignment => ({
  id: "assignment",
  schoolId: "school",
  schoolYearId: "year",
  teacherId: "teacher",
  subjectId: "subject",
  classId: "class",
  weeklyPeriods: 4,
  active: true,
  createdAt: "now",
  updatedAt: "now",
  createdBy: "director",
  updatedBy: "director",
  ...overrides,
});

describe("organisation canonique des périodes", () => {
  it("interprète une affectation legacy comme une répartition normale", () => {
    expect(canonicalSessionPattern(assignment())).toEqual({ mode: "normal" });
    expect(canonicalAssignmentBlockSizes(assignment())).toEqual([1, 1, 1, 1]);
  });

  it("préserve les anciens cours doubles", () => {
    expect(canonicalAssignmentBlockSizes(assignment({ weeklyPeriods: 6, blockSize: 2 }))).toEqual([2, 2, 2]);
  });

  it("canonicalise le multiensemble sans donner de sens à l’ordre visuel", () => {
    const first = canonicalSessionPattern(assignment({ weeklyPeriods: 9, sessionPattern: { mode: "blocks", blocks: [4, 2, 3] } }));
    const second = canonicalSessionPattern(assignment({ weeklyPeriods: 9, sessionPattern: { mode: "blocks", blocks: [3, 4, 2] } }));
    expect(first).toEqual({ mode: "blocks", blocks: [2, 3, 4] });
    expect(second).toEqual(first);
  });

  it("rejette une somme différente du volume hebdomadaire", () => {
    expect(validateAssignmentSessionPattern(9, { mode: "blocks", blocks: [3, 2] }, 6, 6)).toBe("La répartition des blocs totalise 5 périodes, mais ce cours doit avoir 9 périodes par semaine.");
  });

  it("rejette un bloc non entier, trop long ou un nombre de jours insuffisant", () => {
    expect(validateAssignmentSessionPattern(4, { mode: "blocks", blocks: [1.5, 2.5] }, 6, 6)).toContain("entier");
    expect(validateAssignmentSessionPattern(7, { mode: "blocks", blocks: [7] }, 6, 6)).toContain("6 périodes consécutives");
    expect(validateAssignmentSessionPattern(7, { mode: "blocks", blocks: [1, 1, 1, 1, 1, 1, 1] }, 6, 6)).toContain("seulement 6 jours");
  });

  it("accepte 1 à 6 et refuse 7 avec la limite métier par défaut", () => {
    for (let block = 1; block <= MAX_ASSIGNMENT_BLOCK_SIZE; block += 1) {
      expect(validateAssignmentSessionPattern(block, { mode: "blocks", blocks: [block] })).toBe("");
    }
    expect(validateAssignmentSessionPattern(7, { mode: "blocks", blocks: [7] })).toContain("6 périodes consécutives");
  });

  it.each([
    [[4], 4], [[5], 5], [[6], 6], [[4, 4], 8], [[5, 5], 10], [[5, 3], 8], [[6, 2], 8], [[2, 3, 4], 9],
  ])("calcule automatiquement le volume hebdomadaire de %j", (blocks, expected) => {
    expect(weeklyPeriodsFromBlocks(blocks)).toBe(expected);
  });
});
