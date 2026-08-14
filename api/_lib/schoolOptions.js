function optionKey(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

const sciencesAliases = new Set(["science", "sciences", "scientifique", "section scientifique"]);

export function canonicalSchoolOption(value) {
  const trimmed = String(value ?? "").trim().replace(/\s+/g, " ");
  return sciencesAliases.has(optionKey(trimmed)) ? "Sciences" : trimmed;
}

export function normalizeSchoolOptions(values) {
  const options = new Map();
  if (!Array.isArray(values)) return [];
  for (const value of values) {
    const option = canonicalSchoolOption(value);
    if (option && !options.has(optionKey(option))) options.set(optionKey(option), option);
  }
  return [...options.values()];
}
