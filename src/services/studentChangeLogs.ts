import { collection, getDocs, limit, orderBy, query, where, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";

/** Ligne d'historique d'une fiche élève (écrite par le serveur, lisible par l'administrateur). */
export type StudentChangeLog = {
  id: string;
  studentId: string;
  action: "create" | "update";
  actorName: string;
  actorRole: string;
  before: Record<string, string>;
  after: Record<string, string>;
  fields: string[];
  createdAt: string;
};

export const STUDENT_CHANGE_LOG_PAGE_SIZE = 20;

/** Les 20 derniers changements de la fiche, du plus récent au plus ancien. */
export async function loadStudentChangeLogs(schoolId: string, studentId: string): Promise<StudentChangeLog[]> {
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db as unknown as Firestore, "studentChangeLogs"),
    where("schoolId", "==", schoolId), where("studentId", "==", studentId), orderBy("createdAt", "desc"), limit(STUDENT_CHANGE_LOG_PAGE_SIZE)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as StudentChangeLog);
}

const FIELD_LABELS: Record<string, string> = {
  matricule: "Matricule", nom: "Nom", postnom: "Postnom", prenom: "Prénom", sexe: "Sexe", birthDate: "Date de naissance",
  address: "Adresse", phone: "Téléphone", className: "Classe", classId: "Classe (référence)", subClassId: "Sous-classe",
  classOptionKey: "Option (référence)", section: "Section", option: "Option", parentId: "Parent", status: "Statut", photo: "Photo",
};

const ROLE_LABELS: Record<string, string> = { school_admin: "Administrateur", admin: "Administrateur", secretary: "Secrétaire", cashier: "Caissier" };

export const studentChangeFieldLabel = (field: string) => FIELD_LABELS[field] ?? field;
export const studentChangeRoleLabel = (role: string) => ROLE_LABELS[role] ?? role;
