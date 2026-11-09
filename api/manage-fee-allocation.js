import { initAdmin } from "./_lib/firebaseAdmin.js";
import { requireActiveApiUser, verifyActorIdToken } from "./_lib/activeUser.js";
import { requireActiveCoordinationActor } from "./_lib/coordination.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { FeeAllocationError } from "./_lib/feeAllocationMath.js";
import { manageFeeAllocationPhase1 } from "./_lib/feeAllocationPhase1.js";

const sendJson = (res, status, value) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
};

async function readBody(req) {
  if (req.body === null) throw new FeeAllocationError(400, "invalid-argument", "Corps JSON invalide.");
  if (req.body !== undefined) {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new FeeAllocationError(413, "resource-exhausted", "Requête trop volumineuse.");
    try { return typeof req.body === "string" ? JSON.parse(raw) : req.body; }
    catch { throw new FeeAllocationError(400, "invalid-argument", "Corps JSON invalide."); }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new FeeAllocationError(413, "resource-exhausted", "Requête trop volumineuse.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new FeeAllocationError(400, "invalid-argument", "Corps JSON invalide."); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { code: "invalid-argument", error: "Méthode non autorisée." });
  try {
    const authorization = req.headers?.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new FeeAllocationError(401, "unauthenticated", "Authentification requise.");
    const { auth, db } = initAdmin();
    const decoded = await verifyActorIdToken(auth, token);
    const caller = ["coordination_admin", "sub_coordination_admin"].includes(decoded.role)
      ? await requireActiveCoordinationActor(auth, db, token)
      : await requireActiveApiUser(db, decoded);
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new FeeAllocationError(400, "invalid-argument", "Requête invalide.");
    const mutation = ["save-draft", "prepare-version"].includes(body.action);
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? caller.coordinationId ?? ""),
      action: `fee-allocation.${String(body.action ?? "invalid")}`, idempotencyKey: mutation ? body.requestId : undefined,
      ...(mutation ? API_RATE_LIMITS.FINANCE_CREATE : API_RATE_LIMITS.FINANCE_MUTATE) });
    return sendJson(res, 200, await manageFeeAllocationPhase1({ db, caller, body }));
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    if (error instanceof FeeAllocationError) return sendJson(res, error.status, { code: error.code, error: error.message });
    if (error?.statusCode === 401 || error?.statusCode === 403) return sendJson(res, error.statusCode, { code: error.code, error: error.message });
    console.error("[Acadéa fee-allocation] Requête non confirmée.", { code: typeof error?.code === "string" ? error.code : "internal" });
    return sendJson(res, 500, { code: "internal", error: "Répartition indisponible." });
  }
}
