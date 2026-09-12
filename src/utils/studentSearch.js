const MAX_PREFIX_LENGTH = 64;

export function normalizeStudentSearch(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_PREFIX_LENGTH);
}

function prefixes(value) {
  const normalized = normalizeStudentSearch(value);
  if (!normalized) return [];
  const values = new Set();
  for (const token of normalized.split(" ")) {
    for (let length = 1; length <= token.length; length += 1) values.add(token.slice(0, length));
  }
  for (let length = 1; length <= normalized.length; length += 1) values.add(normalized.slice(0, length));
  return [...values];
}

export function studentSearchFields(student) {
  const searchPrefixes = [...new Set([
    ...prefixes(student?.matricule),
    ...prefixes(student?.nom),
    ...prefixes(student?.postnom),
    ...prefixes(student?.prenom),
  ])].sort();
  const status = typeof student?.status === "string" ? student.status.toUpperCase() : "ACTIVE";
  return {
    searchPrefixes,
    searchArchived: Boolean(student?.deletedAt) || status !== "ACTIVE",
  };
}

export function isStudentDocument(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.schoolId === "string"
    && typeof value.schoolYearId === "string"
    && typeof value.matricule === "string"
    && typeof value.nom === "string"
    && typeof value.prenom === "string"
    && typeof value.className === "string";
}
