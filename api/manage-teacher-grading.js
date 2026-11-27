import{initAdmin}from"./_lib/firebaseAdmin.js";import{verifyActorIdToken,requireActiveApiUser}from"./_lib/activeUser.js";import{executeTeacherGrading,GradingApiError}from"./_lib/teacherGrading.js";import{bucketPhotoSigner}from"./_lib/studentPhotoAccess.js";import{executeGradePublication}from"./_lib/gradePublication.js";import{executeSchoolYearArchive}from"./_lib/schoolYearArchive.js";
const send=(res,status,body)=>{res.status(status).json(body)};
import { executeTimetableWorkflow } from "./_lib/timetableWorkflow.js";
import { executeStudyPeriodMutation } from "./_lib/studyPeriodMutations.js";
import { listPedagogicalActivity, PedagogicalHistoryError } from "./_lib/pedagogicalActivity.js";
import { OfflineAttendanceError, syncOfflineAttendance } from "./_lib/offlineAttendance.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { loadPrefectDashboard } from "./_lib/prefectDashboard.js";
import { listPrefectDiscipline } from "./_lib/prefectDiscipline.js";
import { listPrefectStaff } from "./_lib/prefectStaff.js";
import { loadPrefectPayments } from "./_lib/prefectPayments.js";
import { listStaffLabels } from "./_lib/staffLabels.js";
import { executeAttendanceSettings } from "./_lib/attendanceSettingsScope.js";
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "invalid-argument", error: "Méthode non autorisée." });
  try {
    const header = req.headers.authorization ?? "", token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new GradingApiError(401, "unauthenticated", "Authentification requise.");
    const admin = initAdmin(), { auth, db } = admin, caller = await verifyActorIdToken(auth, token), body = req.body ?? {};
    const action = String(body.action ?? "");
    if (action === "sync-offline-attendance") {
      if (Buffer.byteLength(JSON.stringify(body), "utf8") > 16 * 1024) throw new OfflineAttendanceError(400, "invalid-argument", "Requête trop volumineuse.");
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""),
        action: "offline.attendance", idempotencyKey: body.operationId, ...API_RATE_LIMITS.FINANCE_CREATE });
      return send(res, 200, await syncOfflineAttendance({ db, caller, body }));
    }
    // Lot P1 : tableau de pilotage du Préfet d'études (nombres et pourcentages seulement).
    if (action === "prefect-dashboard") {
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""), action: "studies.prefect-dashboard", ...API_RATE_LIMITS.FINANCE_MUTATE });
      return send(res, 200, await loadPrefectDashboard({ db, caller, body }));
    }
    // Lot P2 : discipline des sections du Préfet d'études, en lecture seule.
    if (action === "prefect-discipline") {
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""), action: "studies.prefect-discipline", ...API_RATE_LIMITS.FINANCE_MUTATE });
      return send(res, 200, await listPrefectDiscipline({ db, caller, body }));
    }
    // Lot P3 : enseignants des sections du Préfet d'études (cours, charge, absences approuvées).
    if (action === "prefect-staff") {
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""), action: "studies.prefect-staff", ...API_RATE_LIMITS.FINANCE_MUTATE });
      return send(res, 200, await listPrefectStaff({ db, caller, body }));
    }
    // Lot P4 : situation des paiements des sections du Préfet d'études (pourcentages par classe, aucun montant).
    if (action === "prefect-payments") {
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""), action: "studies.prefect-payments", ...API_RATE_LIMITS.FINANCE_MUTATE });
      return send(res, 200, await loadPrefectPayments({ db, caller, body }));
    }
    // Lot R1 : nom et fonction des auteurs des réglages (« Modifié par … »).
    if (action === "staff-labels") {
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""), action: "studies.staff-labels", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
      return send(res, 200, await listStaffLabels({ db, caller, body }));
    }
    // Lot R3 : périmètre et enregistrement des réglages de présence d'un Directeur de discipline avec sections.
    if (action === "attendance-settings-scope" || action === "attendance-settings-save") {
      if (Buffer.byteLength(JSON.stringify(body), "utf8") > 256 * 1024) throw new GradingApiError(400, "invalid-argument", "Requête trop volumineuse.");
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""), action: action === "attendance-settings-save" ? "discipline.attendance-settings-save" : "discipline.attendance-settings-scope", ...(action === "attendance-settings-save" ? API_RATE_LIMITS.FINANCE_MUTATE : API_RATE_LIMITS.MESSAGE_RECIPIENTS) });
      return send(res, 200, await executeAttendanceSettings({ db, caller, body }));
    }
    const execute = action === "list-pedagogical-history" ? listPedagogicalActivity : action.startsWith("study-period-") || action === "study-class-vacations" ? executeStudyPeriodMutation : action.startsWith("timetable-") ? executeTimetableWorkflow
      : action.startsWith("archive-") ? executeSchoolYearArchive
        : action.startsWith("grades-") ? executeGradePublication : executeTeacherGrading;
    // Liste enseignant : adresses de photo temporaires, signées seulement à la demande.
    const signPhoto = execute === executeTeacherGrading ? (path) => bucketPhotoSigner(admin.bucket)(path) : undefined;
    return send(res, 200, await execute({ db, caller, body, signPhoto }));
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    if (error instanceof OfflineAttendanceError) return send(res, error.status, { code: error.code, error: error.message });
    if (error?.code === 10 || error?.code === "aborted") return send(res, 409, { code: "offline-conflict", error: "La présence a changé. Réessayez après actualisation." });
    if (error instanceof GradingApiError || error instanceof PedagogicalHistoryError) return send(res, error.status, { code: error.code, error: error.message, ...(error.report ? { report: error.report } : {}) });
    if (error?.statusCode === 400 && !error?.code) return send(res, 400, { code: "invalid-argument", error: "Corps JSON invalide." });
    if (error?.statusCode === 401 || error?.statusCode === 403) return send(res, error.statusCode, { code: error.code, error: error.message });
    console.error("[Acadéa cotation] Échec.", { code: typeof error?.code === "string" ? error.code : "internal" });
    return send(res, 500, { code: "internal", error: "Opération de cotation impossible." });
  }
}
