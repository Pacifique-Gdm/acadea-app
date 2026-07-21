import { getVerifiedServiceAccount, initAdmin } from "./_lib/firebaseAdmin.js";
import { attachRequestId, createApiLogger, getRequestId, internalServerError } from "./_lib/logger.js";

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function currentEnvironment() {
  return process.env.VITE_APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

export default function handler(req, res) {
  const requestId = getRequestId(req);
  attachRequestId(res, requestId);
  const logger = createApiLogger({ endpoint: "/api/health", method: req.method, requestId });

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method-not-allowed", message: "Methode non autorisee.", requestId });
    return;
  }

  try {
    const serviceAccount = getVerifiedServiceAccount();
    initAdmin();
    const firebaseProjectId = String(serviceAccount.project_id ?? "");
    logger.info("Health check OK.", { firebaseProjectId });
    sendJson(res, 200, {
      status: "ok",
      environment: currentEnvironment(),
      firebaseProjectId,
    });
  } catch (error) {
    logger.error("Health check Firebase Admin indisponible.", error);
    sendJson(res, 503, internalServerError(requestId));
  }
}
