import { createHash } from "node:crypto";

export class HttpRateLimitError extends Error {
  constructor(retryAfter) {
    super("Trop de tentatives. Veuillez patienter quelques instants avant de réessayer.");
    this.name = "HttpRateLimitError";
    this.status = 429;
    this.code = "resource-exhausted";
    this.retryAfter = retryAfter;
  }
}

export const API_RATE_LIMITS = Object.freeze({
  FINANCE_CREATE: { limit: 60, windowMs: 60_000 },
  FINANCE_MUTATE: { limit: 15, windowMs: 60_000 },
  PROVISION_SCHOOL: { limit: 3, windowMs: 10 * 60_000 },
  PROVISION_ACCOUNT: { limit: 20, windowMs: 5 * 60_000 },
  PROVISION_DESTRUCTIVE: { limit: 10, windowMs: 5 * 60_000 },
  SCHOOL_ADMIN: { limit: 20, windowMs: 5 * 60_000 },
  SCHOOL_DELETE: { limit: 5, windowMs: 60 * 60_000 },
  PARENT_MESSAGE: { limit: 12, windowMs: 60_000 },
});

function limiterId(actorId, schoolId, action) {
  return createHash("sha256").update(`${actorId}\u001f${schoolId}\u001f${action}`).digest("hex");
}

export async function enforceApiRateLimit({ db, actorId, schoolId, action, limit, windowMs, idempotencyKey, nowMs = Date.now() }) {
  if (!actorId || !schoolId || !action || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1000) throw new Error("Configuration du rate limiter invalide.");
  const reference = db.doc(`_rateLimits/${limiterId(actorId, schoolId, action)}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.exists ? snapshot.data() ?? {} : {};
    const resetAtMs = typeof data.resetAt?.toMillis === "function" ? data.resetAt.toMillis() : data.resetAt instanceof Date ? data.resetAt.getTime() : 0;
    const activeWindow = resetAtMs > nowMs;
    const count = activeWindow && Number.isInteger(data.count) ? data.count : 0;
    const nextResetAtMs = activeWindow ? resetAtMs : nowMs + windowMs;
    const requestHash = typeof idempotencyKey === "string" && idempotencyKey ? limiterId(actorId, action, idempotencyKey) : "";
    const priorRequestHashes = activeWindow && Array.isArray(data.requestHashes) ? data.requestHashes.filter((value) => typeof value === "string").slice(-Math.min(limit, 100)) : [];
    if (requestHash && priorRequestHashes.includes(requestHash)) return { remaining: Math.max(0, limit - count), resetAt: nextResetAtMs, idempotent: true };
    if (count >= limit) throw new HttpRateLimitError(Math.max(1, Math.ceil((nextResetAtMs - nowMs) / 1000)));
    transaction.set(reference, { actorIdHash: limiterId(actorId, "actor", action), schoolIdHash: limiterId("school", schoolId, action), action, count: count + 1, requestHashes: requestHash ? [...priorRequestHashes, requestHash].slice(-Math.min(limit, 100)) : [], windowStartedAt: new Date(activeWindow ? nextResetAtMs - windowMs : nowMs), resetAt: new Date(nextResetAtMs), expiresAt: new Date(nextResetAtMs + 24 * 60 * 60_000) });
    return { remaining: limit - count - 1, resetAt: nextResetAtMs };
  });
}

export function sendRateLimitError(res, error) {
  if (!(error instanceof HttpRateLimitError)) return false;
  res.statusCode = 429;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Retry-After", String(error.retryAfter));
  res.end(JSON.stringify({ error: error.message, code: error.code, retryAfter: error.retryAfter }));
  return true;
}
