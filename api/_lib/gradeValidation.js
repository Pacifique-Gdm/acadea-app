import { createHash } from "node:crypto";
import { GradingApiError } from "./teacherGrading.js";
import { PREFECT_FUNCTION } from "./prefectDashboard.js";
import { getSchoolSections, normalizeSchoolSection, userSectionIds } from "./sectionAuthority.js";

// Lot P6 (Préfet d'études) : validation des bulletins avant publication.
// - La validation n'est EXIGÉE que si un Préfet d'études actif existe pour la section de la classe.
//   Sinon, la Direction des études publie comme aujourd'hui, sans aucun changement.
// - Un Préfet existe pour une section si l'une de ses sections est celle de la classe ; pour une classe
//   sans section, si ses sections couvrent toutes celles de l'école (règle unique des sections).
//   Un Préfet sans aucune section ne compte pas (comme pour P1 et P2 : il ne voit rien).
// - La validation est rangée dans `gradeValidations`, écrite et lue par le serveur seulement
//   (la règle générale « tout refusé » de firestore.rules la couvre déjà : aucune règle ne change).
// - Elle porte l'empreinte des résultats de la classe pour la période : si une cote change après
//   la validation, une nouvelle validation est demandée.

const digest = (value) => createHash("sha256").update(value).digest("hex");
const serialize = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

export const validationId = (schoolId, schoolYearId, classId, slot) => `grade_validation_${digest(JSON.stringify([schoolId, schoolYearId, classId, slot]))}`;

const activePrefect = (user, schoolId) => user?.role === "study_director" && user.schoolId === schoolId && user.studyFunction === PREFECT_FUNCTION
  && user.active !== false && user.status !== "inactive";

/** Vrai si ce Préfet (compte `users`) est responsable de la section de la classe. */
export function prefectCoversClass(user, school, classSection) {
  const sections = userSectionIds(user);
  if (!sections.length) return false;
  const section = normalizeSchoolSection(classSection);
  if (section) return sections.includes(section);
  const schoolSections = getSchoolSections(school);
  return schoolSections.length > 0 && schoolSections.every((item) => sections.includes(item));
}

/** Calcul pur : la validation est-elle exigée pour cette classe ? */
export function validationRequired(users, school, schoolId, classSection) {
  return users.some((user) => activePrefect(user, schoolId) && prefectCoversClass(user, school, classSection));
}

export async function loadValidationRequired(db, school, schoolId, classSection) {
  const users = serialize(await db.collection("users").where("schoolId", "==", schoolId).where("role", "==", "study_director").get());
  return validationRequired(users, school, schoolId, classSection);
}

/** Empreinte des résultats de la période (élèves, cotes, pourcentages, rangs). */
export function reportFingerprint(report, slot) {
  const rows = report.students.map((row) => [
    row.student.id,
    report.courses.map((course) => [course.key, row.scores[course.key]?.[slot] ?? null, row.maxima[course.key]?.[slot] ?? null, row.statuses[course.key]?.[slot] ?? null]),
    row.evaluations[slot]?.complete === true, row.evaluations[slot]?.percentage ?? null, row.evaluations[slot]?.rank ?? null,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return digest(JSON.stringify(rows));
}

/** État de la validation pour la période : `validated` seulement si les résultats n'ont pas changé depuis. */
export function validationState(record, fingerprint) {
  if (!record || record.status !== "validated") return { validated: false, stale: false };
  const stale = record.fingerprint !== fingerprint;
  return { validated: !stale, stale, validatedAt: record.validatedAt, validatedBy: record.validatedBy };
}

/** Refus serveur de la publication : à appeler dans la transaction de publication. */
export async function assertPublicationValidated({ db, school, schoolId, schoolYearId, classId, classSection, slot, report }) {
  if (!(await loadValidationRequired(db, school, schoolId, classSection))) return;
  const snapshot = await db.doc(`gradeValidations/${validationId(schoolId, schoolYearId, classId, slot)}`).get();
  const state = validationState(snapshot.exists ? snapshot.data() : null, reportFingerprint(report, slot));
  if (state.stale) throw new GradingApiError(409, "validation-required", "Les cotes ont changé depuis la validation du Préfet d'études : une nouvelle validation est nécessaire avant la publication.");
  if (!state.validated) throw new GradingApiError(409, "validation-required", "Validation du Préfet d'études requise avant la publication de cette classe pour cette période.");
}
