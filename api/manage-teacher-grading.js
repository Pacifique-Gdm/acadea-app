import{initAdmin}from"./_lib/firebaseAdmin.js";import{verifyActorIdToken}from"./_lib/activeUser.js";import{executeTeacherGrading,GradingApiError}from"./_lib/teacherGrading.js";import{executeGradePublication}from"./_lib/gradePublication.js";import{executeSchoolYearArchive}from"./_lib/schoolYearArchive.js";
const send=(res,status,body)=>{res.status(status).json(body)};
import { executeTimetableWorkflow } from "./_lib/timetableWorkflow.js";
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { code: "invalid-argument", error: "Méthode non autorisée." });
  try {
    const header = req.headers.authorization ?? "", token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new GradingApiError(401, "unauthenticated", "Authentification requise.");
    const { auth, db } = initAdmin(), caller = await verifyActorIdToken(auth, token), body = req.body ?? {};
    const action = String(body.action ?? "");
    const execute = action.startsWith("timetable-") ? executeTimetableWorkflow
      : action.startsWith("archive-") ? executeSchoolYearArchive
        : action.startsWith("grades-") ? executeGradePublication : executeTeacherGrading;
    return send(res, 200, await execute({ db, caller, body }));
  } catch (error) {
    if (error instanceof GradingApiError) return send(res, error.status, { code: error.code, error: error.message, ...(error.report ? { report: error.report } : {}) });
    if (error?.statusCode === 400 && !error?.code) return send(res, 400, { code: "invalid-argument", error: "Corps JSON invalide." });
    if (error?.statusCode === 401) return send(res, 401, { code: error.code, error: error.message });
    console.error("[Acadéa cotation] Échec.", { code: typeof error?.code === "string" ? error.code : "internal" });
    return send(res, 500, { code: "internal", error: "Opération de cotation impossible." });
  }
}
