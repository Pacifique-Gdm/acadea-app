import { createHash } from "node:crypto";

const OPERATIONS = new Set([
  "students.count", "students.page", "dashboard.arrears", "dashboard.currency",
  "valves.upload", "ai.secretary", "ai.studies",
]);
const SERVICES = new Set(["api", "firestore", "storage", "functions", "browser-storage", "network", "unknown"]);
const OPERATION_SERVICES = new Map([
  ["students.count", new Set(["firestore", "browser-storage", "network", "unknown"])],
  ["students.page", new Set(["firestore", "browser-storage", "network", "unknown"])],
  ["dashboard.arrears", new Set(["api", "network", "unknown"])],
  ["dashboard.currency", new Set(["api", "network", "unknown"])],
  ["valves.upload", new Set(["storage", "browser-storage", "network", "unknown"])],
  ["ai.secretary", new Set(["functions", "network", "unknown"])],
  ["ai.studies", new Set(["functions", "network", "unknown"])],
]);
const CODES = new Set([
  "resource-exhausted", "quota-exceeded", "permission-denied", "unauthenticated",
  "unavailable", "deadline-exceeded", "aborted", "failed-precondition",
  "internal", "invalid-argument", "network-failed", "browser-storage-quota", "unknown",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOW_MS = 60_000;
const actorWindows = new Map();
let globalWindow = { resetAt: 0, count: 0 };

export function validateClientFailure(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["operation", "service", "code", "status", "correlationId", "durationMs", "attempts"].includes(key))) return null;
  if (!OPERATIONS.has(input.operation) || !SERVICES.has(input.service)
    || !OPERATION_SERVICES.get(input.operation)?.has(input.service) || !CODES.has(input.code)
    || !UUID.test(input.correlationId)
    || !Number.isInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 120_000
    || !Number.isInteger(input.attempts) || input.attempts < 1 || input.attempts > 5
    || !(input.status === null || (Number.isInteger(input.status) && input.status >= 400 && input.status <= 599))) return null;
  return {
    operation: input.operation, service: input.service, code: input.code,
    status: input.status, correlationId: input.correlationId,
    durationMs: input.durationMs, attempts: input.attempts,
  };
}

// No Firestore reads or writes: diagnostics must not worsen an exhausted quota.
// Serverless instances have independent limits; the client also deduplicates.
export function allowClientFailure(uid, now = Date.now()) {
  if (now >= globalWindow.resetAt) globalWindow = { resetAt: now + WINDOW_MS, count: 0 };
  if (globalWindow.count >= 60) return false;
  const key = createHash("sha256").update(uid).digest("hex");
  const prior = actorWindows.get(key);
  const window = !prior || now >= prior.resetAt ? { resetAt: now + WINDOW_MS, count: 0 } : prior;
  if (window.count >= 3) return false;
  window.count += 1;
  globalWindow.count += 1;
  actorWindows.set(key, window);
  if (actorWindows.size > 1000) {
    for (const [actor, value] of actorWindows) if (now >= value.resetAt) actorWindows.delete(actor);
  }
  return true;
}
