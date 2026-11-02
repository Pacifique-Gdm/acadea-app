import { initAdmin } from "./_lib/firebaseAdmin.js";
import { verifyActorIdToken } from "./_lib/activeUser.js";
import { enforceApiRateLimit, sendRateLimitError, API_RATE_LIMITS } from "./_lib/rateLimit.js";
import { FeeTypeError, saveFeeTypes } from "./_lib/feeTypeMutations.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body === null) throw new FeeTypeError(400, "invalid-argument", "Corps JSON invalide.");
  if (req.body !== undefined) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new FeeTypeError(400, "invalid-argument", "Requête de frais trop volumineuse.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { code: "invalid-argument", error: "Méthode non autorisée." });
  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return sendJson(res, 401, { code: "unauthenticated", error: "Authentification requise." });
    const { auth, db } = initAdmin();
    const caller = await verifyActorIdToken(auth, token);
    if (!caller.schoolId || !["admin", "school_admin"].includes(caller.role)) throw new FeeTypeError(403, "permission-denied", "Gestion des frais non autorisée.");
    const raw = await readBody(req);
    if (raw === null || (typeof raw === "string" && Buffer.byteLength(raw, "utf8") > 32_768)) throw new FeeTypeError(400, "invalid-argument", "Requête de frais invalide.");
    let body;
    try { body = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new FeeTypeError(400, "invalid-argument", "Corps JSON invalide."); }
    if (!body || typeof body !== "object" || Buffer.byteLength(JSON.stringify(body), "utf8") > 32_768) throw new FeeTypeError(400, "invalid-argument", "Requête de frais invalide.");
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.schoolId, action: "finance.save-fee-types", idempotencyKey: body.requestId, ...API_RATE_LIMITS.FINANCE_CREATE });
    const result = await saveFeeTypes({ db, caller, body });
    return sendJson(res, 200, result);
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    if (error instanceof FeeTypeError || error?.statusCode === 401) return sendJson(res, error.status ?? error.statusCode, { code: error.code, error: error.message });
    console.error("[Acadéa frais] Enregistrement échoué.", { code: typeof error?.code === "string" ? error.code : "internal" });
    return sendJson(res, 500, { code: "internal", error: "Enregistrement non confirmé. Vérifiez l'état de la demande." });
  }
}
