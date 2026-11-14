import { doc, getDoc, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { Student } from "../types";
import { failureKind } from "./requestFailure";

/** Après une coupure pendant l'inscription : relit la fiche par son
 * identifiant (le même est réutilisé à chaque tentative, jamais de doublon).
 * - la fiche existe et appartient à l'école/année demandées → l'élève est enregistré ;
 * - null → la fiche n'existe pas (les règles refusent la lecture d'un document absent) ;
 * - undefined → vérification impossible (toujours hors ligne). */
export async function findSavedStudent(studentId: string, schoolId: string, schoolYearId: string, read = readStudent): Promise<Student | null | undefined> {
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
