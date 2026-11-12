import { auth } from "../firebase";
import { resolveApiUrl } from "../config/apiUrl";
import { getIdToken } from "firebase/auth";

export type ClientFailureOperation = "students.count" | "students.page" | "dashboard.arrears" | "dashboard.currency"
  | "valves.upload" | "ai.secretary" | "ai.studies";
type Service = "api" | "firestore" | "storage" | "functions" | "browser-storage" | "network" | "unknown";

const CODES = new Set([
  "resource-exhausted", "quota-exceeded", "permission-denied", "unauthenticated", "unavailable",
  "deadline-exceeded", "aborted", "failed-precondition", "internal", "invalid-argument",
  "network-failed", "browser-storage-quota", "unknown",
]);
const REPORT_WINDOW_MS = 10 * 60_000;
const CRITICAL_CODES = new Set(["resource-exhausted", "quota-exceeded", "browser-storage-quota", "permission-denied", "unavailable", "internal"]);

export function createClientReportLimiter() {
  const lastSent = new Map<string, number>();
  const reports: Array<{ at: number; critical: boolean }> = [];
  return (key: string, critical: boolean, now = Date.now()) => {
    while (reports.length && now - reports[0].at >= REPORT_WINDOW_MS) reports.shift();
    for (const [knownKey, at] of lastSent) if (now - at >= REPORT_WINDOW_MS) lastSent.delete(knownKey);
    if (lastSent.has(key) || reports.length >= 5 || (!critical && reports.filter((item) => !item.critical).length >= 3)) return false;
    reports.push({ at: now, critical });
    lastSent.set(key, now);
    return true;
  };
}

const allowReport = createClientReportLimiter();

export function normalizedClientFailure(error: unknown, fallbackService: Service) {
  const value = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; name?: unknown } : {};
  const rawCode = typeof value.code === "string" ? value.code.toLowerCase() : "";
  const code = typeof value.name === "string" && value.name === "QuotaExceededError" ? "browser-storage-quota"
    : rawCode.split("/").at(-1) || (value.name === "TypeError" ? "network-failed" : "unknown");
  const service: Service = code === "browser-storage-quota" ? "browser-storage"
    : code === "network-failed" ? "network"
    : rawCode.startsWith("storage/") ? "storage"
      : rawCode.startsWith("functions/") ? "functions"
        : rawCode.startsWith("firestore/") ? "firestore" : fallbackService;
  const status = typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599
    ? value.status : null;
  return { service, code: CODES.has(code) ? code : "unknown", status };
}

/** Best effort only: one bounded request per distinct failure, with no queue in IndexedDB. */
export async function reportClientFailure(operation: ClientFailureOperation, error: unknown, startedAt = Date.now()) {
  const user = auth?.currentUser;
  if (!user || typeof fetch !== "function" || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  const failure = normalizedClientFailure(error, operation.startsWith("dashboard.") ? "api"
    : operation.startsWith("ai.") ? "functions" : operation.startsWith("valves.") ? "storage" : "firestore");
  const key = `${operation}:${failure.service}:${failure.code}:${failure.status ?? ""}`;
  const now = Date.now();
  const critical = failure.status === 429 || (failure.status !== null && failure.status >= 500) || CRITICAL_CODES.has(failure.code);
  if (!allowReport(key, critical, now)) return;
  try {
    const token = await getIdToken(user, false);
    await fetch(resolveApiUrl("/api/manage-financial-transaction"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "report-client-failure", event: { operation, ...failure, correlationId: crypto.randomUUID(),
        durationMs: Math.max(0, Math.min(120_000, Math.trunc(now - startedAt))), attempts: 1 } }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Diagnostics must never change the outcome of the user operation or retry.
  }
}
