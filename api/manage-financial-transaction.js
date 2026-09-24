import { initAdmin } from "./_lib/firebaseAdmin.js";
import { requireActiveApiUser, verifyActorIdToken } from "./_lib/activeUser.js";
import { authorizeFinancialCaller, executeFinancialOperation, FinancialApiError } from "./_lib/financialTransactions.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";

function parseJsonBody(raw) {
  try { return JSON.parse(raw || "{}"); }
  catch { throw new FinancialApiError(400, "invalid-argument", "Corps JSON invalide."); }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") {
    if (Buffer.byteLength(JSON.stringify(req.body), "utf8") > 64 * 1024) throw new FinancialApiError(400, "invalid-argument", "Requête financière trop volumineuse.");
    return req.body;
  }
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body, "utf8") > 64 * 1024) throw new FinancialApiError(400, "invalid-argument", "Requête financière trop volumineuse.");
    return parseJsonBody(req.body);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new FinancialApiError(400, "invalid-argument", "Requête financière trop volumineuse.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return parseJsonBody(raw);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Méthode non autorisée.", code: "invalid-argument" });
  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new FinancialApiError(401, "unauthenticated", "Authentification requise.");
    const { auth, db } = initAdmin();
    const caller = await verifyActorIdToken(auth, token);
    const body = await readBody(req);
    const requestedAction = typeof body.action === "string" ? body.action : "";
    const action = ["create-payment", "create-expense", "update-payment", "update-expense", "delete-payment", "delete-expense"].includes(requestedAction) ? requestedAction : "invalid";
    const authorizedCaller = authorizeFinancialCaller(caller, action);
    await requireActiveApiUser(db, authorizedCaller);
    const rate = action === "create-payment" || action === "create-expense" ? API_RATE_LIMITS.FINANCE_CREATE : API_RATE_LIMITS.FINANCE_MUTATE;
    await enforceApiRateLimit({ db, actorId: authorizedCaller.uid, schoolId: authorizedCaller.schoolId, action: `finance.${action}`, idempotencyKey: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined, ...rate });
    const result = await executeFinancialOperation({ db, caller: authorizedCaller, body });
    return sendJson(res, 200, result);
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    if (error instanceof FinancialApiError) return sendJson(res, error.status, { error: error.message, code: error.code });
    if (error?.statusCode === 401) return sendJson(res, 401, { error: error.message, code: error.code });
    if (error?.statusCode === 403 && error?.code === "permission-denied") return sendJson(res, 403, { error: error.message, code: error.code });
    console.error("[Acadéa finance] Opération financière échouée.", { code: typeof error?.code === "string" ? error.code : "internal" });
    return sendJson(res, 500, { error: "Opération financière impossible.", code: "internal" });
  }
}
