export class SchoolYearValidationError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "SchoolYearValidationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function requireActiveSchoolYear(db, schoolId, schoolYearId) {
  if (typeof schoolId !== "string" || !schoolId || typeof schoolYearId !== "string" || !schoolYearId) {
    throw new SchoolYearValidationError(400, "invalid-argument", "École et année scolaire requises.");
  }
  const snapshot = await db.doc(`schoolYears/${schoolYearId}`).get();
  const year = snapshot.exists ? snapshot.data() : undefined;
  if (!year || year.schoolId !== schoolId) {
    throw new SchoolYearValidationError(400, "invalid-argument", "Année scolaire invalide pour cet établissement.");
  }
  if (year.status !== "active") {
    throw new SchoolYearValidationError(409, "failed-precondition", "Cette année scolaire est archivée en lecture seule.");
  }
  return year;
}
