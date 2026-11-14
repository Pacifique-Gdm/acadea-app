/** Photos d'élèves pour l'enseignant (lot 9). L'enseignant n'a pas d'accès direct
 * à Storage : le serveur, qui a déjà vérifié ses cours, joint à chaque élève de
 * sa liste une adresse de lecture valable 10 minutes. Rien n'est enregistré. */
const PHOTO_PATH = /^schools\/[A-Za-z0-9_-]{1,160}\/student-photos\/[A-Za-z0-9_-]{1,160}\/[0-9a-fA-F-]{36}\.(jpg|png|webp)$/;
export const TEACHER_PHOTO_URL_TTL_MS = 10 * 60 * 1000;

export function bucketPhotoSigner(bucket, now = () => Date.now()) {
  return async (path) => {
    if (typeof path !== "string" || !PHOTO_PATH.test(path)) throw new Error("Chemin de photo invalide.");
    const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: now() + TEACHER_PHOTO_URL_TTL_MS });
    return url;
  };
}

export async function withTeacherPhotoUrls(students, schoolId, signPhoto) {
  if (!signPhoto || !Array.isArray(students)) return students;
  return Promise.all(students.map(async (student) => {
    if (!student?.photoPath || student.schoolId !== schoolId || !String(student.photoPath).startsWith(`schools/${schoolId}/student-photos/`)) return student;
    const photoStorageUrl = await signPhoto(student.photoPath).catch(() => undefined);
    return photoStorageUrl ? { ...student, photoStorageUrl } : student;
  }));
}
