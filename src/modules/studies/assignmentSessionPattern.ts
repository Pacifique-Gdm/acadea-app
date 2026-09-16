import type { AssignmentSessionPattern, PedagogicalAssignment } from "./studyTypes";

export type CanonicalAssignmentSessionPattern = { mode: "normal" } | AssignmentSessionPattern;

export function canonicalBlockSizes(blocks: readonly number[]) {
  return [...blocks].sort((left, right) => left - right);
}

export function canonicalSessionPattern(assignment: Pick<PedagogicalAssignment, "weeklyPeriods" | "blockSize" | "sessionPattern">): CanonicalAssignmentSessionPattern {
  if (assignment.sessionPattern?.mode === "blocks") return { mode: "blocks", blocks: canonicalBlockSizes(assignment.sessionPattern.blocks) };
  return { mode: "normal" };
}

export function canonicalAssignmentBlockSizes(assignment: Pick<PedagogicalAssignment, "weeklyPeriods" | "blockSize" | "sessionPattern">) {
  if (assignment.sessionPattern?.mode === "blocks") return canonicalBlockSizes(assignment.sessionPattern.blocks);
  const legacyBlockSize = assignment.blockSize ?? 1;
  if (legacyBlockSize > 1 && assignment.weeklyPeriods % legacyBlockSize === 0) return Array.from({ length: assignment.weeklyPeriods / legacyBlockSize }, () => legacyBlockSize);
  return Array.from({ length: assignment.weeklyPeriods }, () => 1);
}

export function assignmentUsesDistinctBlockDays(assignment: Pick<PedagogicalAssignment, "blockSize" | "sessionPattern">) {
  return assignment.sessionPattern?.mode === "blocks" || (assignment.blockSize ?? 1) > 1;
}

export function validateAssignmentSessionPattern(weeklyPeriods: number, pattern: AssignmentSessionPattern | null | undefined, maxBlockSize = Number.POSITIVE_INFINITY, maxDistinctDays = 6) {
  if (!pattern) return "";
  if (pattern.mode !== "blocks" || !Array.isArray(pattern.blocks) || pattern.blocks.length === 0) return "Ajoutez au moins un bloc de périodes.";
  if (pattern.blocks.length > maxDistinctDays) return `Cette organisation nécessite ${pattern.blocks.length} jours distincts, mais seulement ${maxDistinctDays} jours sont disponibles.`;
  if (pattern.blocks.some((block) => !Number.isInteger(block) || block < 1)) return "Chaque bloc doit contenir un nombre entier positif de périodes.";
  const longest = Math.max(...pattern.blocks);
  if (longest > maxBlockSize) return `Un bloc ne peut pas dépasser ${maxBlockSize} périodes consécutives avec les tranches horaires configurées.`;
  const total = pattern.blocks.reduce((sum, block) => sum + block, 0);
  return total === weeklyPeriods ? "" : `La répartition des blocs totalise ${total} périodes, mais ce cours doit avoir ${weeklyPeriods} périodes par semaine.`;
}

export function normalizedSessionPattern(pattern: AssignmentSessionPattern | null | undefined) {
  return pattern ? { mode: "blocks" as const, blocks: canonicalBlockSizes(pattern.blocks) } : undefined;
}
