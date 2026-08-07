import { initAdmin } from "./_lib/firebaseAdmin.js";
import { executeFinancialOperation, FinancialApiError } from "./_lib/financialTransactions.js";

async function readBody(req) {
  if (req.body && typeof req.body === "object") {
    if (Buffer.byteLength(JSON.stringify(req.body), "utf8") > 64 * 1024) throw new FinancialApiError(400, "invalid-argument", "Requête financière trop volumineuse.");
    return req.body;
  }
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body, "utf8") > 64 * 1024) throw new FinancialApiError(400, "invalid-argument", "Requête financière trop volumineuse.");
    return JSON.parse(req.body || "{}");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new FinancialApiError(400, "invalid-argument", "Requête financière trop volumineuse.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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
    const caller = await auth.verifyIdToken(token, true);
    const result = await executeFinancialOperation({ db, caller, body: await readBody(req) });
    return sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof FinancialApiError) return sendJson(res, error.status, { error: error.message, code: error.code });
    console.error("[Acadéa finance] Opération financière échouée.", { code: typeof error?.code === "string" ? error.code : "internal" });
    return sendJson(res, 500, { error: "Opération financière impossible.", code: "internal" });
  }
}
