import type { DisciplineSanction } from "../types";

export type DisciplineStats = {
  total: number;
  active: number;
  completed: number;
  sanctionedStudents: number;
  recurrences: number;
  byType: { type: string; count: number }[];
  byClass: { className: string; count: number }[];
};

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapToRows<TKey extends "type" | "className">(map: Map<string, number>, keyName: TKey): Array<Record<TKey, string> & { count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((first, second) => second.count - first.count || String(first[keyName]).localeCompare(String(second[keyName]), "fr")) as Array<Record<TKey, string> & { count: number }>;
}

export function buildDisciplineStats(sanctions: DisciplineSanction[]): DisciplineStats {
  const students = new Set<string>();
  const byType = new Map<string, number>();
  const byClass = new Map<string, number>();

  for (const sanction of sanctions) {
    students.add(sanction.studentId);
    increment(byType, sanction.sanctionType || "Non renseigné");
    increment(byClass, sanction.className || "Non renseignée");
  }

  return {
    total: sanctions.length,
    active: sanctions.filter((sanction) => sanction.status === "active").length,
    completed: sanctions.filter((sanction) => sanction.status === "completed").length,
    sanctionedStudents: students.size,
    recurrences: sanctions.filter((sanction) => sanction.recurrenceNumber > 0).length,
    byType: mapToRows(byType, "type"),
    byClass: mapToRows(byClass, "className"),
  };
}
