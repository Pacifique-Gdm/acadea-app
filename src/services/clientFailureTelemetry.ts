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
const lastSent = new Map<string, number>();
let sentCount = 0;

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
  if (!user || sentCount >= 5 || typeof fetch !== "function") return;
  const failure = normalizedClientFailure(error, operation.startsWith("dashboard.") ? "api"
    : operation.startsWith("ai.") ? "functions" : operation.startsWith("valves.") ? "storage" : "firestore");
  const key = `${operation}:${failure.service}:${failure.code}:${failure.status ?? ""}`;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < 10 * 60_000) return;
  lastSent.set(key, now);
  sentCount += 1;
  try {
    const token = await getIdToken(user, false);
    await fetch(resolveApiUrl("/api/client-failure"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, ...failure, correlationId: crypto.randomUUID(),
        durationMs: Math.max(0, Math.min(120_000, Math.trunc(now - startedAt))), attempts: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Diagnostics must never change the outcome of the user operation or retry.
  }
}
