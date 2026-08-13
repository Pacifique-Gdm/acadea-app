import type { Student } from "../types";

export const defaultStudentBiometric: NonNullable<Student["biometric"]> = {
  fingerprintStatus: "not_enrolled",
  fingerprintUpdatedAt: null,
  cardStatus: "not_assigned",
  cardUid: null,
  cardUpdatedAt: null,
};

export function generateMatricule(students: Student[], yearName: string, schoolId: string, schoolYearId: string) {
  const year = yearName.slice(2, 4);
  const count = students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId).length + 1;
  return `ACD-${year}-${String(count).padStart(4, "0")}`;
}

export function isArchivedStudent(student: Student) {
  return Boolean(student.deletedAt) || (student.status ?? "ACTIVE") !== "ACTIVE";
}

export function validateStudentForSave(student: Student, schoolId: string, schoolYearId: string) {
  if (!schoolId || !schoolYearId) return "L’école et l’année scolaire actives sont obligatoires.";
  if (!student.nom.trim()) return "Le nom de l’élève est obligatoire.";
  if (!student.prenom.trim()) return "Le prénom de l’élève est obligatoire.";
  if (!student.className) return "La classe de l’élève est obligatoire.";
  return "";
}

/** Removes only undefined optional properties before a Student is sent to Firestore. */
export function studentForPersistence(student: Student): Student {
  return Object.fromEntries(Object.entries(student).filter(([, value]) => value !== undefined)) as unknown as Student;
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
    section: "Primaire",
    status: "ACTIVE",
    photoUrl: "",
    biometric: { ...defaultStudentBiometric },
  };
}
