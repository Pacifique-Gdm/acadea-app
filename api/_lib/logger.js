import { randomUUID } from "node:crypto";

const sensitiveKeyPattern = /authorization|cookie|password|token|secret|credential|private_key|client_email|serviceaccount|firebase_service_account_json/i;

function currentEnvironment() {
  return process.env.VITE_APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

function firebaseProjectId() {
  return process.env.VITE_FIREBASE_PROJECT_ID
    || process.env.ACADEA_EXPECTED_PRODUCTION_FIREBASE_PROJECT_ID
    || process.env.ACADEA_EXPECTED_PREVIEW_FIREBASE_PROJECT_ID
    || "";
}

export function getRequestId(req) {
  const incomingRequestId = req.headers?.["x-request-id"];
  if (typeof incomingRequestId === "string" && incomingRequestId.trim()) return incomingRequestId.trim();
  return randomUUID();
}

export function attachRequestId(res, requestId) {
  if (requestId) {
    res.setHeader("X-Request-Id", requestId);
  }
}

export function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Error) return safeError(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : redact(entry, seen),
    ]),
  );
}

export function safeError(error) {
  if (!(error instanceof Error)) {
    return redact({ message: String(error) });
  }

  return redact({
    name: error.name,
    code: error.code,
    message: error.message,
  });
}

function writeLog(level, context, message, extra = {}) {
  const payload = redact({
    level,
    timestamp: new Date().toISOString(),
    environment: currentEnvironment(),
    endpoint: context.endpoint,
    method: context.method,
    requestId: context.requestId,
    schoolId: context.schoolId,
    userId: context.userId,
    role: context.role,
    firebaseProjectId: context.firebaseProjectId || firebaseProjectId(),
    message,
    ...extra,
  });

  const serialized = JSON.stringify(payload);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

export function createApiLogger(baseContext) {
  return {
    info(message, extra) {
      writeLog("info", baseContext, message, extra);
    },
    warn(message, extra) {
      writeLog("warn", baseContext, message, extra);
    },
    error(message, error, extra = {}) {
      writeLog("error", baseContext, message, { ...extra, error: safeError(error) });
    },
  };
}

export function internalServerError(requestId) {
  return {
    error: "Une erreur interne est survenue.",
    requestId,
  };
}
