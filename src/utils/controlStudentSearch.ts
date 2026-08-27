import type { Student } from "../types";

function normalizeControlStudentSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

export function filterControlStudentRows<T extends { student: Pick<Student, "nom" | "postnom" | "prenom" | "matricule"> }>(rows: T[], query: string) {
  const normalizedQuery = normalizeControlStudentSearch(query);
  if (!normalizedQuery) return rows;

  return rows.filter(({ student }) => normalizeControlStudentSearch(
    `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`,
  ).includes(normalizedQuery));
}
