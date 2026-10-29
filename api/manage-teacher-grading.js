import{initAdmin}from"./_lib/firebaseAdmin.js";import{verifyActorIdToken,requireActiveApiUser}from"./_lib/activeUser.js";import{executeTeacherGrading,GradingApiError}from"./_lib/teacherGrading.js";import{executeGradePublication}from"./_lib/gradePublication.js";import{executeSchoolYearArchive}from"./_lib/schoolYearArchive.js";
const send=(res,status,body)=>{res.status(status).json(body)};
import { executeTimetableWorkflow } from "./_lib/timetableWorkflow.js";
import { listPedagogicalActivity, PedagogicalHistoryError } from "./_lib/pedagogicalActivity.js";
import { OfflineAttendanceError, syncOfflineAttendance } from "./_lib/offlineAttendance.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "invalid-argument", error: "Méthode non autorisée." });
  try {
    const header = req.headers.authorization ?? "", token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new GradingApiError(401, "unauthenticated", "Authentification requise.");
    const { auth, db } = initAdmin(), caller = await verifyActorIdToken(auth, token), body = req.body ?? {};
    const action = String(body.action ?? "");
    if (action === "sync-offline-attendance") {
      if (Buffer.byteLength(JSON.stringify(body), "utf8") > 16 * 1024) throw new OfflineAttendanceError(400, "invalid-argument", "Requête trop volumineuse.");
      await requireActiveApiUser(db, caller);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? ""),
        action: "offline.attendance", idempotencyKey: body.operationId, ...API_RATE_LIMITS.FINANCE_CREATE });
      return send(res, 200, await syncOfflineAttendance({ db, caller, body }));
    }
    const execute = action === "list-pedagogical-history" ? listPedagogicalActivity : action.startsWith("timetable-") ? executeTimetableWorkflow
      : action.startsWith("archive-") ? executeSchoolYearArchive
        : action.startsWith("grades-") ? executeGradePublication : executeTeacherGrading;
    return send(res, 200, await execute({ db, caller, body }));
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
