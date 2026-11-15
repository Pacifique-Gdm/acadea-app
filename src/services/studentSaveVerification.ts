import { doc, getDoc, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { Student } from "../types";
import { failureKind } from "./requestFailure";
import { deleteStudentPhoto } from "./studentPhotoStorage";

/** Après une coupure pendant l'inscription : relit la fiche par son
 * identifiant (le même est réutilisé à chaque tentative, jamais de doublon).
 * - la fiche existe et appartient à l'école/année demandées → l'élève est enregistré ;
 * - null → la fiche n'existe pas (les règles refusent la lecture d'un document absent) ;
 * - undefined → vérification impossible (toujours hors ligne). */
export async function findSavedStudent(studentId: string, schoolId: string, schoolYearId: string, read: (studentId: string) => Promise<Student | null> = readStudent): Promise<Student | null | undefined> {
  try {
    const student = await read(studentId);
    if (!student) return null;
    return student.schoolId === schoolId && student.schoolYearId === schoolYearId ? student : null;
  } catch (error) {
    return failureKind(error) === "permission" ? null : undefined;
  }
}

async function readStudent(studentId: string): Promise<Student | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db as unknown as Firestore, "students", studentId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as Student : null;
}

/** Photo envoyée pour une inscription qui a échoué : elle n'est retirée qu'après
 * confirmation qu'aucune fiche ne l'utilise. Si la vérification est impossible
 * (réponse incertaine, hors ligne), la photo est gardée. */
export async function discardUploadedPhotoIfUnused(target: { path: string; studentId: string; schoolId: string; schoolYearId: string },
  deps: { read?: (studentId: string) => Promise<Student | null>; remove?: (path: string) => Promise<void> } = {}): Promise<"kept" | "deleted"> {
  const saved = await findSavedStudent(target.studentId, target.schoolId, target.schoolYearId, deps.read);
  if (saved === undefined || saved?.photoPath === target.path) return "kept";
  await (deps.remove ?? deleteStudentPhoto)(target.path);
  return "deleted";
}
