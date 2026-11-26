import { GradingApiError } from "./teacherGrading.js";

// Lot R1 (réglages par section) : « Modifié par [nom, fonction] ».
// La Direction des études et le Directeur de discipline ne lisent pas les comptes de leurs collègues :
// le serveur renvoie SEULEMENT le nom et la fonction des membres du personnel de la MÊME école.
// Ni adresse, ni téléphone, ni sections. Aucune règle de sécurité ne change.
export const STUDY_FUNCTION_LABELS = Object.freeze({
  director_of_studies: "Directeur des études",
  prefect_of_studies: "Préfet d'études",
  primary_director: "Directeur primaire",
  nursery_director: "Directrice maternelle",
});
const ROLE_LABELS = Object.freeze({
  school_admin: "Administrateur", admin: "Administrateur", secretary: "Secrétaire", cashier: "Caissier",
  discipline_director: "Directeur de discipline", teacher: "Enseignant",
});
export const STAFF_LABEL_READERS = ["study_director", "discipline_director", "school_admin", "admin"];
const MAX_IDS = 50;

export function staffFunctionLabel(user) {
  if (user?.role === "study_director") return STUDY_FUNCTION_LABELS[user.studyFunction] ?? STUDY_FUNCTION_LABELS.director_of_studies;
  return ROLE_LABELS[user?.role];
}

export async function staffLabels(db, schoolId, uids) {
  const ids = [...new Set((Array.isArray(uids) ? uids : []).filter((value) => typeof value === "string" && value && value.length <= 200 && !value.includes("/")))].slice(0, MAX_IDS);
  const snapshots = await Promise.all(ids.map((id) => db.doc(`users/${id}`).get()));
  const labels = {};
  snapshots.forEach((snapshot, index) => {
    const user = snapshot.exists ? snapshot.data() : undefined;
    const functionLabel = staffFunctionLabel(user);
    if (!user || user.schoolId !== schoolId || !functionLabel) return;
    labels[ids[index]] = { name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : functionLabel, functionLabel };
  });
  return labels;
}

export async function listStaffLabels({ db, caller, body }) {
  const schoolId = typeof body?.schoolId === "string" ? body.schoolId : "";
  if (!STAFF_LABEL_READERS.includes(caller?.role) || !schoolId || caller.schoolId !== schoolId) {
    throw new GradingApiError(403, "permission-denied", "Consultation non autorisée.");
  }
  if (!Array.isArray(body.userIds) || body.userIds.length > MAX_IDS) throw new GradingApiError(400, "invalid-argument", "Liste de comptes invalide.");
  return { labels: await staffLabels(db, schoolId, body.userIds) };
}
