import { HttpsError } from "firebase-functions/v2/https";

type Snapshot = { exists: boolean; data(): Record<string, unknown> | undefined };
export type SchoolYearDatabase = { doc(path: string): { get(): Promise<Snapshot> } };

export async function assertActiveSchoolYear(db: SchoolYearDatabase, schoolId: string, schoolYearId: unknown) {
  if (typeof schoolYearId !== "string" || !schoolYearId.trim()) {
    throw new HttpsError("invalid-argument", "Année scolaire requise.");
  }
  const snapshot = await db.doc(`schoolYears/${schoolYearId}`).get();
  const year = snapshot.exists ? snapshot.data() : undefined;
  if (!year || year.schoolId !== schoolId) {
    throw new HttpsError("invalid-argument", "Année scolaire invalide pour cet établissement.");
  }
  if (year.status !== "active") {
    throw new HttpsError("failed-precondition", "Cette année scolaire est archivée en lecture seule.");
  }
  return { id: schoolYearId, ...year };
}
