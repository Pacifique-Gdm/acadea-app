import { GradingApiError, loadConsolidatedSchoolClass } from "./teacherGrading.js";
import { calculateConsolidatedReport } from "./consolidatedGrading.js";
import { PUBLICATION_SLOTS } from "./gradePublicationCriteria.js";
import { PREFECT_FUNCTION } from "./prefectDashboard.js";
import { staffLabels } from "./staffLabels.js";
import { loadValidationRequired, prefectCoversClass, reportFingerprint, validationId, validationState } from "./gradeValidation.js";

// Lot P6 : actions de la validation des bulletins (point d'entrée existant api/manage-teacher-grading.js,
// préfixe « grades- » : aucun nouveau fichier api/).
//  - grades-validation-status   : Direction des études de la classe → exigée ? état par période.
//  - grades-validation-validate : Préfet d'études de la section → valide une classe et une période.
//  - grades-validation-cancel   : Préfet d'études de la section → retire sa validation.

const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new GradingApiError(400, "invalid-argument", `${label} invalide.`);
  return value.trim();
};
const denied = (message = "Accès non autorisé.") => new GradingApiError(403, "permission-denied", message);

async function context(db, caller, schoolId, schoolYearId, classId, write) {
  if (caller?.role !== "study_director" || caller.schoolId !== schoolId) throw denied();
  const [userSnap, schoolSnap, yearSnap, classSnap] = await Promise.all([
    db.doc(`users/${caller.uid}`).get(), db.doc(`schools/${schoolId}`).get(), db.doc(`schoolYears/${schoolYearId}`).get(), db.doc(`classes/${classId}`).get(),
  ]);
  const user = userSnap.data(), school = schoolSnap.data(), year = yearSnap.data(), schoolClass = classSnap.data();
  if (!userSnap.exists || user?.role !== "study_director" || user?.schoolId !== schoolId || user?.active === false || user?.status === "inactive"
    || !schoolSnap.exists || ["suspended", "inactive", "deleting"].includes(school?.status)
    || !yearSnap.exists || year?.schoolId !== schoolId) throw denied("Compte, école ou année scolaire invalide.");
  if (!classSnap.exists || schoolClass?.schoolId !== schoolId || schoolClass?.schoolYearId !== schoolYearId) throw denied("Classe hors établissement.");
  // Même contrôle de section que la publication des cotes.
  const permittedSections = Array.isArray(user.sectionIds) ? user.sectionIds : user.section ? [user.section] : [];
  if (schoolClass.section && permittedSections.length && !permittedSections.includes(schoolClass.section)) throw denied("Section hors du périmètre autorisé.");
  if (write && (year.status !== "active" || school.activeSchoolYearId !== schoolYearId)) throw denied("Une année archivée est en consultation uniquement.");
  return { user, school, schoolClass };
}

const classReport = async (db, schoolId, schoolYearId, classId) => calculateConsolidatedReport(await loadConsolidatedSchoolClass(db, schoolId, schoolYearId, classId));

/** État par période (avec nom et fonction de l'auteur), ou null si la validation n'est pas exigée pour cette classe. */
export async function publicationValidations({ db, school, schoolId, schoolYearId, classId, classSection, report }) {
  if (!(await loadValidationRequired(db, school, schoolId, classSection))) return null;
  const records = await Promise.all(PUBLICATION_SLOTS.map((slot) => db.doc(`gradeValidations/${validationId(schoolId, schoolYearId, classId, slot)}`).get()));
  const states = Object.fromEntries(PUBLICATION_SLOTS.map((slot, index) => {
    const fingerprint = reportFingerprint(report, slot);
    return [slot, { ...validationState(records[index].exists ? records[index].data() : null, fingerprint), fingerprint }];
  }));
  const authors = await staffLabels(db, schoolId, Object.values(states).map((state) => state.validatedBy).filter(Boolean));
  return Object.fromEntries(Object.entries(states).map(([slot, { validatedBy, ...state }]) => [slot, {
    ...state, ...(validatedBy && authors[validatedBy] ? { validatedByName: authors[validatedBy].name, validatedByFunction: authors[validatedBy].functionLabel } : {}),
  }]));
}

export async function executeGradeValidation({ db, caller, body, action, schoolId, schoolYearId }) {
  const classId = required(body.classId, "Classe");
  if (classId.includes("/")) throw new GradingApiError(400, "invalid-argument", "Classe invalide.");
  const write = action === "grades-validation-validate" || action === "grades-validation-cancel";
  if (!write && action !== "grades-validation-status") throw new GradingApiError(400, "invalid-argument", "Action inconnue.");
  const { user, school, schoolClass } = await context(db, caller, schoolId, schoolYearId, classId, write);
  const report = await classReport(db, schoolId, schoolYearId, classId);
  if (action === "grades-validation-status") {
    const validations = await publicationValidations({ db, school, schoolId, schoolYearId, classId, classSection: schoolClass.section, report });
    return { required: Boolean(validations), ...(validations ? { validations } : {}) };
  }
  if (user.studyFunction !== PREFECT_FUNCTION || !prefectCoversClass(user, school, schoolClass.section)) throw denied("Réservé au Préfet d'études de cette section.");
  const slot = required(body.slot, "Période");
  if (!PUBLICATION_SLOTS.includes(slot)) throw new GradingApiError(400, "invalid-argument", "Période invalide.");
  const ref = db.doc(`gradeValidations/${validationId(schoolId, schoolYearId, classId, slot)}`);
  const now = new Date().toISOString();
  if (action === "grades-validation-cancel") {
    await ref.set({ schoolId, schoolYearId, classId, slot, status: "cancelled", cancelledAt: now, cancelledBy: caller.uid }, { merge: true });
    return { ok: true, validated: false };
  }
  const fingerprint = reportFingerprint(report, slot);
  // Le Préfet valide ce qu'il a vu : si les cotes ont changé depuis son affichage, il recharge.
  if (typeof body.expectedFingerprint === "string" && body.expectedFingerprint !== fingerprint) {
    throw new GradingApiError(409, "already-modified", "Les cotes ont changé depuis l'affichage : rechargez avant de valider.");
  }
  const evaluated = report.students.filter((row) => row.evaluations[slot]?.complete).length;
  if (!evaluated) throw new GradingApiError(409, "failed-precondition", "Aucun élève n'a de résultat complet pour cette période.");
  await ref.set({ schoolId, schoolYearId, classId, slot, status: "validated", fingerprint, validatedAt: now, validatedBy: caller.uid });
  return { ok: true, validated: true, validatedAt: now };
}
