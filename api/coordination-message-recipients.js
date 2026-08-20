import { initAdmin } from "./_lib/firebaseAdmin.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { activeCoordinationSchoolIds, chunks, coordinationHttpError, requireActiveCoordinator } from "./_lib/coordination.js";

const ALLOWED_ROLES = new Set(["school_admin", "discipline_director", "study_director", "cashier", "teacher", "parent", "secretary"]);
function sendJson(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed", message: "Méthode non autorisée." });
  try {
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
    if (!token) throw coordinationHttpError(401, "not-authenticated", "Authentification requise.");
    const { auth, db } = initAdmin();
    const caller = await requireActiveCoordinator(auth, db, token);
    const schoolIds = await activeCoordinationSchoolIds(db, caller.coordinationId);
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: "coordination.message.recipients", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
    const selectedSchoolId = String(req.query?.schoolId ?? "").trim();
    if (selectedSchoolId && !schoolIds.includes(selectedSchoolId)) throw coordinationHttpError(403, "school-outside-coordination", "École hors Coordination.");
    const scope = selectedSchoolId ? [selectedSchoolId] : schoolIds;
    const recipients = [];
    for (const batch of chunks(scope, 30)) {
      let cursor;
      do {
        let usersQuery = db.collection("users").where("schoolId", "in", batch).limit(500);
        if (cursor) usersQuery = usersQuery.startAfter(cursor);
        const snapshot = await usersQuery.get();
        snapshot.docs.forEach((item) => {
          const profile = item.data();
          const role = profile.role === "admin" ? "school_admin" : profile.role;
          if (ALLOWED_ROLES.has(role) && profile.active !== false && profile.status !== "inactive") recipients.push({ uid: item.id, name: String(profile.name ?? profile.displayName ?? "Utilisateur"), role, schoolId: profile.schoolId });
        });
        cursor = snapshot.docs.at(-1);
        if (snapshot.docs.length < 500) break;
      } while (cursor);
    }
    recipients.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return sendJson(res, 200, { recipients });
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    return sendJson(res, Number(error?.statusCode) || 500, { error: error?.code || "server-error", message: Number(error?.statusCode) >= 500 ? "Destinataires indisponibles." : error.message });
  }
}
