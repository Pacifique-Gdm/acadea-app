import type { Student } from "../types";

export function generateMatricule(students: Student[], yearName: string, schoolId: string, schoolYearId: string) {
  const year = yearName.slice(2, 4);
  const count = students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId).length + 1;
  return `ACD-${year}-${String(count).padStart(4, "0")}`;
}

export function isArchivedStudent(student: Student) {
  return Boolean(student.deletedAt) || (student.status ?? "ACTIVE") !== "ACTIVE";
}

export function emptyStudent(schoolId: string, schoolYearId: string): Student {
  return {
    id: `new-${crypto.randomUUID()}`,
    schoolId,
    schoolYearId,
    annee_scolaire_id: schoolYearId,
    matricule: "",
    nom: "",
    postnom: "",
    prenom: "",
    sexe: "M",
    birthDate: "",
    address: "",
    phone: "",
    className: "1ère Primaire",
    section: "primaire",
    status: "ACTIVE",
    photoUrl: "",
  };
}
