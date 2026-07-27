function normalizedStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

/** Normalise le tableau actuel et les anciennes représentations Firestore connues. */
export function normalizeSchoolOptions(value: unknown): string[] {
  if (Array.isArray(value)) return normalizedStrings(value);
  if (!value || typeof value !== "object") return [];

  const legacy = value as Record<string, unknown>;
  for (const field of ["options", "values", "items"]) {
    if (Array.isArray(legacy[field])) return normalizedStrings(legacy[field]);
  }

  return normalizedStrings(
    Object.entries(legacy).flatMap(([option, enabled]) => {
      if (enabled === true) return [option];
      if (typeof enabled === "string") return [enabled];
      return [];
    }),
  );
}
