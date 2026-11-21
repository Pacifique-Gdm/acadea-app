import { initAdmin } from "./_lib/firebaseAdmin.js";
import { listAllowedMessageRecipients, requireMessagingCaller } from "./_lib/messageRecipients.js";
import { requireActiveApiUser, verifyActorIdToken } from "./_lib/activeUser.js";
import { registerPushDevice } from "./_lib/pushDeviceRegistry.js";
import { requireActiveSuperAdmin, searchPlatformRecipients, sendPlatformMessage } from "./_lib/platformMessaging.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function parseBody(body) {
  if (body && typeof body === "object") return body;
  try { return JSON.parse(typeof body === "string" ? body : "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed", message: "Methode non autorisee." });
  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw Object.assign(new Error("Authentification requise."), { statusCode: 401, code: "not-authenticated" });
    const { auth, db } = initAdmin();
    const decoded = await verifyActorIdToken(auth, token);
    const requestBody = req.method === "POST" ? parseBody(req.body) : {};
    if (requestBody.action === "register-push-device") {
      // P4, lot 4 : action ajoutée ici (et non dans une nouvelle page) car Vercel limite le nombre de pages serveur.
      const caller = await requireActiveApiUser(db, decoded);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.schoolId || "platform", action: "push.device.register", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
      return sendJson(res, 200, await registerPushDevice(db, caller, requestBody));
    }
    if (decoded.role === "super_admin") {
      // Lot 23 : messagerie du Super administrateur (coordinations, sous-coordinations, administrateurs d'école).
      const admin = await requireActiveSuperAdmin(db, decoded);
      if (req.method === "GET") {
        await enforceApiRateLimit({ db, actorId: admin.uid, schoolId: "platform", action: "platform.message.recipients", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
        // Lot SA-6 : recherche par nom, page par page (plus de liste complète).
        return sendJson(res, 200, await searchPlatformRecipients(db, req.query ?? {}));
      }
      const body = requestBody;
      const idempotencyKey = typeof req.headers["x-idempotency-key"] === "string" ? req.headers["x-idempotency-key"] : "";
      if (body.action !== "send") throw Object.assign(new Error("Action invalide."), { statusCode: 400, code: "invalid-action" });
      await enforceApiRateLimit({ db, actorId: admin.uid, schoolId: "platform", action: "platform.message.send", idempotencyKey, ...API_RATE_LIMITS.SCHOOL_MESSAGE });
      return sendJson(res, 200, await sendPlatformMessage(db, admin, { ...body, idempotencyKey }));
    }
    if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed", message: "Methode non autorisee." });
    const caller = await requireMessagingCaller(auth, db, token);
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.schoolId, action: "school.message.recipients", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
    const schoolYearId = typeof req.query?.schoolYearId === "string" ? req.query.schoolYearId.trim() : "";
    const recipients = await listAllowedMessageRecipients(db, caller, schoolYearId);
    sendJson(res, 200, { recipients });
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    const statusCode = Number(error?.statusCode) || 500;
    const code = typeof error?.code === "string" ? error.code : "server-error";
    if (statusCode >= 500) console.error("[Acadea messaging] Chargement des destinataires impossible.", { code, errorName: error?.name });
    sendJson(res, statusCode, { error: code, message: statusCode >= 500 ? "Destinataires indisponibles. Veuillez reessayer." : error.message });
  }
}
