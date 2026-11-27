import { GradingApiError } from "./teacherGrading.js";
import { GRADE_SLOTS } from "./consolidatedGrading.js";
import { comparableSection } from "./studySectionScope.js";
import { requireActiveSchoolYear } from "./schoolYear.js";
import { ORIENTATION_ADVISOR, SLOT_LABELS, advisorReports, loadGradingSources, requireSchoolActor } from "./advisors.js";

// Lot 11 : Conseiller d'orientation.
// - Résultats des élèves en LECTURE (pourcentage et rang de la dernière période complète).
// - Notes de suivi CONFIDENTIELLES : écrites par le Conseiller d'orientation ; lues par lui (ses notes),
//   par la Direction des études (élèves de ses sections) et par l'administrateur. JAMAIS par les enseignants
//   ni par les parents. Collection fermée au navigateur : tout passe par ce fichier.
// AUCUN accès à l'argent.
const MAX_TEXT = 4000;
const NOTE_KINDS = new Set(["interview", "observation", "orientation", "other"]);
const fail = (status, message) => { throw new GradingApiError(status, status === 403 ? "permission-denied" : status === 404 ? "not-found" : status === 409 ? "failed-precondition" : "invalid-argument", message); };
const serialize = (snapshot) => (snapshot.docs ?? []).map((item) => ({ id: item.id, ...item.data() }));
const textField = (value) => typeof value === "string" ? value.trim() : "";
const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(400, `${label} invalide.`);
  return value.trim();
};
const inSections = (sections, section) => !sections.length || sections.includes(comparableSection(section));
const studentName = (student) => textField(student?.fullName) || `${textField(student?.lastName)} ${textField(student?.firstName)}`.trim() || textField(student?.name) || "Élève";

/** Calcul pur : résultat de chaque élève à la dernière période complète de sa classe (pourcentage, rang, effectif évalué). */
export function computeAdvisorResults(input) {
  const rows = [];
  for (const { schoolClass, report } of advisorReports(input)) {
    const slot = [...GRADE_SLOTS].reverse().find((candidate) => report.students.some((row) => row.evaluations[candidate]?.complete));
    for (const row of report.students) {
      const evaluation = slot ? row.evaluations[slot] : undefined;
      rows.push({
        studentId: row.student.id, studentName: studentName(row.student), className: textField(schoolClass.name) || "Classe",
        section: comparableSection(schoolClass.section) ?? "",
        slot: slot ?? null, slotLabel: slot ? SLOT_LABELS[slot] : null,
        percentage: evaluation?.complete ? Math.round(evaluation.percentage * 10) / 10 : null,
        rank: evaluation?.complete ? evaluation.rank : null,
        evaluated: slot ? report.students.filter((item) => item.evaluations[slot]?.complete).length : 0,
      });
    }
  }
  return { sections: [...input.sections], results: rows.sort((a, b) => a.className.localeCompare(b.className, "fr") || a.studentName.localeCompare(b.studentName, "fr")) };
}

export async function loadAdvisorResults({ db, caller, body }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, [ORIENTATION_ADVISOR]);
  return computeAdvisorResults({ sections, ...await loadGradingSources(db, schoolId, schoolYearId, sections) });
}

export const NOTE_READER_ROLES = [ORIENTATION_ADVISOR, "study_director", "school_admin", "admin"];
const date = (value, label) => {
  const raw = textField(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail(400, `${label} invalide.`);
  return raw;
};

/** Calcul pur : contrôle et nettoie une note envoyée par l'écran. */
export function normalizeNoteInput(input = {}) {
  const content = textField(input.content);
  if (!content) fail(400, "Écrivez le contenu de la note.");
  if (content.length > MAX_TEXT) fail(400, `Note : ${MAX_TEXT} caractères au plus.`);
  return {
    studentId: required(input.studentId, "Élève"),
    noteDate: date(input.noteDate, "Date"),
    kind: NOTE_KINDS.has(input.kind) ? input.kind : "interview",
    content,
  };
}

/** Calcul pur : notes visibles par un compte. Enseignant, parent, caissier… : aucune. */
export function visibleNotes({ role, uid, sections, notes }) {
  return notes.filter((note) => {
    if (role === ORIENTATION_ADVISOR) return note.authorId === uid;
    if (role === "study_director") return inSections(sections, note.section);
    return role === "school_admin" || role === "admin";
  }).sort((a, b) => String(b.noteDate ?? "").localeCompare(String(a.noteDate ?? "")) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

const noteView = (note) => ({
  id: note.id, studentId: note.studentId, studentName: note.studentName, className: note.className, section: note.section,
  noteDate: note.noteDate, kind: note.kind, content: note.content, authorId: note.authorId, authorName: note.authorName ?? "",
  createdAt: note.createdAt, updatedAt: note.updatedAt,
});

export async function listOrientationNotes({ db, caller, body }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, NOTE_READER_ROLES, "Notes de suivi non autorisées.");
  let query = db.collection("orientationNotes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  if (caller.role === ORIENTATION_ADVISOR) query = query.where("authorId", "==", caller.uid);
  return { notes: visibleNotes({ role: caller.role, uid: caller.uid, sections, notes: serialize(await query.get()) }).map(noteView) };
}

export async function saveOrientationNote({ db, caller, body, now = () => new Date().toISOString() }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { profile, sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, [ORIENTATION_ADVISOR], "Seul le Conseiller d'orientation écrit les notes de suivi.");
  await requireActiveSchoolYear(db, schoolId, schoolYearId).catch((error) => fail(error?.statusCode === 409 ? 409 : 400, error?.message || "Année scolaire invalide."));
  const input = normalizeNoteInput(body.note);
  const studentSnap = await db.doc(`students/${input.studentId}`).get();
  const student = studentSnap.exists ? studentSnap.data() : undefined;
  if (!student || student.schoolId !== schoolId || student.schoolYearId !== schoolYearId || student.deletedAt) fail(400, "Élève introuvable dans cette année scolaire.");
  if (!inSections(sections, student.section)) fail(403, "Cet élève n'est pas dans vos sections.");
  const stamp = now();
  const content = { ...input, studentName: studentName(student), className: textField(student.className), section: comparableSection(student.section) ?? textField(student.section), updatedAt: stamp };
  const noteId = textField(body.noteId);
  if (!noteId) {
    const ref = db.collection("orientationNotes").doc();
    const note = { ...content, schoolId, schoolYearId, authorId: caller.uid, authorName: textField(profile?.name) || "Conseiller d'orientation", createdAt: stamp };
    await ref.set(note);
    return { note: noteView({ id: ref.id, ...note }) };
  }
  const ref = db.doc(`orientationNotes/${noteId}`);
  const saved = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : undefined;
    if (!current || current.schoolId !== schoolId || current.schoolYearId !== schoolYearId) fail(404, "Note de suivi introuvable.");
    if (current.authorId !== caller.uid) fail(403, "Vous ne pouvez modifier que vos propres notes.");
    const next = { ...current, ...content };
    transaction.set(ref, next);
    return next;
  });
  return { note: noteView({ id: noteId, ...saved }) };
}
