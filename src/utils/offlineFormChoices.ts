import type { OfflineContext, OfflineStudent } from "../services/offlineContext";

const names = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
export function sortedOfflineStudents(students: readonly OfflineStudent[]) {
  return [...students].sort((a, b) => names.compare(a.name.trim().replace(/\s+/g, " "), b.name.trim().replace(/\s+/g, " ")) || a.id.localeCompare(b.id));
}

/** A fee document is the canonical obligation identity, never its display label.
 * Old caches lack applicability metadata and must be refreshed, not guessed. */
export function offlineFeeChoices(context: OfflineContext | null, studentId: string) {
  const student = context?.students.find((item) => item.id === studentId);
  if (!context || !student?.feeTypeIds) return [];
  const permitted = new Set(student.feeTypeIds);
  const rows = context.fees.filter((fee) => permitted.has(fee.id));
  const unique = new Map<string, typeof rows[number]>();
  const ambiguous = new Set<string>();
  for (const fee of rows) {
    const previous = unique.get(fee.id);
    if (previous && (previous.currency !== fee.currency || previous.amount !== fee.amount)) ambiguous.add(fee.id);
    else unique.set(fee.id, fee);
  }
  return [...unique.values()].filter((fee) => !ambiguous.has(fee.id));
}

export function offlineEnrollmentClasses(context: OfflineContext | null) {
  return context?.classes.filter((item) => item.operational === true) ?? [];
}
