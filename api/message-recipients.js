import { initAdmin } from "./_lib/firebaseAdmin.js";
import { listAllowedMessageRecipients, requireMessagingCaller } from "./_lib/messageRecipients.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed", message: "Methode non autorisee." });
  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw Object.assign(new Error("Authentification requise."), { statusCode: 401, code: "not-authenticated" });
    const { auth, db } = initAdmin();
    const caller = await requireMessagingCaller(auth, db, token);
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.schoolId, action: "school.message.recipients", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
    const recipients = await listAllowedMessageRecipients(db, caller);
    sendJson(res, 200, { recipients });
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    const statusCode = Number(error?.statusCode) || 500;
    const code = typeof error?.code === "string" ? error.code : "server-error";
    if (statusCode >= 500) console.error("[Acadea messaging] Chargement des destinataires impossible.", { code, errorName: error?.name });
    sendJson(res, statusCode, { error: code, message: statusCode >= 500 ? "Destinataires indisponibles. Veuillez reessayer." : error.message });
  }
}
