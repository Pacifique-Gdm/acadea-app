const MAX_PREFIX_LENGTH = 64;

export function normalizeStudentSearch(value) {
  if (typeof value !== "string") return "";
  return normalizeStudentIdentityPart(value).slice(0, MAX_PREFIX_LENGTH);
}

export function normalizeStudentIdentityPart(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function studentIdentityKey(student) {
  return JSON.stringify([student?.nom, student?.postnom, student?.prenom].map(normalizeStudentIdentityPart));
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

/** Lot « allègement des index des élèves » (décision du 19/11) : seulement les FINS du matricule (2 caractères ou plus),
 * en plus de ses débuts (ajoutés par `prefixes`). « ACD-26-0042 » se trouve avec « ACD », « ACD-26 », « 0042 » ou « 42 »,
 * plus avec un morceau du milieu comme « 6-00 ». Les morceaux du milieu faisaient 56 des 72 préfixes d'un élève. */
function matriculeFragments(value) {
  const normalized = normalizeStudentSearch(value);
  if (normalized.length < 2) return [];
  const values = new Set();
  for (let start = 0; start < normalized.length - 1; start += 1) values.add(normalized.slice(start));
  return [...values];
}

export function studentSearchFields(student) {
  const searchPrefixes = [...new Set([
    ...prefixes(student?.matricule),
    ...matriculeFragments(student?.matricule),
    ...prefixes(student?.nom),
    ...prefixes(student?.postnom),
    ...prefixes(student?.prenom),
  ])].sort();
  const status = typeof student?.status === "string" ? student.status.toUpperCase() : "ACTIVE";
  return {
    searchPrefixes,
    searchArchived: Boolean(student?.deletedAt) || status !== "ACTIVE",
    sortName: studentAlphabeticalKey(student),
  };
}

export function studentAlphabeticalKey(student) {
  return normalizeStudentSearch([student?.nom, student?.postnom, student?.prenom].filter(Boolean).join(" "));
}

export function compareStudentsAlphabetically(left, right) {
  const keyDifference = studentAlphabeticalKey(left).localeCompare(studentAlphabeticalKey(right), "fr", { sensitivity: "base" });
  return keyDifference || String(left?.id ?? "").localeCompare(String(right?.id ?? ""), "fr");
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
