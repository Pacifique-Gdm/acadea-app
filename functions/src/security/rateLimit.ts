import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";

type Reference = { path?: string };
type Snapshot = { exists: boolean; data(): Record<string, unknown> | undefined };
type Transaction = { get(reference: Reference): Promise<Snapshot>; set(reference: Reference, value: Record<string, unknown>): unknown };
export type RateLimitDatabase = { doc(path: string): Reference; runTransaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> };

export const FUNCTION_RATE_LIMITS = {
  AI_GENERATE: { limit: 5, windowMs: 60_000 },
  AI_DECISION: { limit: 30, windowMs: 60_000 },
  AI_RESET: { limit: 3, windowMs: 60 * 60_000 },
  AI_SETTINGS: { limit: 10, windowMs: 10 * 60_000 },
  SECRETARY_DOCUMENT: { limit: 30, windowMs: 60_000 },
  SECRETARY_DELETE: { limit: 3, windowMs: 60 * 60_000 },
} as const;

function limiterId(actorId: string, schoolId: string, action: string) {
  return createHash("sha256").update(`${actorId}\u001f${schoolId}\u001f${action}`).digest("hex");
}

export async function enforceCallableRateLimit(input: { db: RateLimitDatabase; actorId: string; schoolId: string; action: string; limit: number; windowMs: number; idempotencyKey?: string; nowMs?: number }) {
  const nowMs = input.nowMs ?? Date.now();
  if (!input.actorId || !input.schoolId || !input.action || !Number.isInteger(input.limit) || input.limit < 1 || !Number.isInteger(input.windowMs) || input.windowMs < 1000) throw new HttpsError("internal", "Protection anti-abus indisponible.");
  const reference = input.db.doc(`_rateLimits/${limiterId(input.actorId, input.schoolId, input.action)}`);
  try {
    return await input.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.exists ? snapshot.data() ?? {} : {};
      const rawResetAt = data.resetAt;
      const resetAtMs = typeof (rawResetAt as { toMillis?: unknown })?.toMillis === "function" ? (rawResetAt as { toMillis(): number }).toMillis() : rawResetAt instanceof Date ? rawResetAt.getTime() : 0;
      const activeWindow = resetAtMs > nowMs;
      const count = activeWindow && Number.isInteger(data.count) ? Number(data.count) : 0;
      const nextResetAtMs = activeWindow ? resetAtMs : nowMs + input.windowMs;
      const requestHash = input.idempotencyKey ? limiterId(input.actorId, input.action, input.idempotencyKey) : "";
      const priorRequestHashes = activeWindow && Array.isArray(data.requestHashes) ? data.requestHashes.filter((value): value is string => typeof value === "string").slice(-Math.min(input.limit, 100)) : [];
      if (requestHash && priorRequestHashes.includes(requestHash)) return { remaining: Math.max(0, input.limit - count), resetAt: nextResetAtMs, idempotent: true };
      const retryAfter = Math.max(1, Math.ceil((nextResetAtMs - nowMs) / 1000));
      if (count >= input.limit) throw new HttpsError("resource-exhausted", "Trop de tentatives. Veuillez patienter quelques instants avant de réessayer.", { retryAfter });
      transaction.set(reference, { actorIdHash: limiterId(input.actorId, "actor", input.action), schoolIdHash: limiterId("school", input.schoolId, input.action), action: input.action, count: count + 1, requestHashes: requestHash ? [...priorRequestHashes, requestHash].slice(-Math.min(input.limit, 100)) : [], windowStartedAt: new Date(activeWindow ? nextResetAtMs - input.windowMs : nowMs), resetAt: new Date(nextResetAtMs), expiresAt: new Date(nextResetAtMs + 24 * 60 * 60_000) });
      return { remaining: input.limit - count - 1, resetAt: nextResetAtMs };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Protection anti-abus indisponible.");
  }
}
