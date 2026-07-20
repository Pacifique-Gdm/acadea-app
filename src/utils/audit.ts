import type { AppUser, AuditLog } from "../types";

export function operationTimestamp(value?: string) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function nearestCreationLog(auditLogs: AuditLog[], action: string, createdAt: string | undefined, matchesDetails: (details: string) => boolean) {
  const operationTime = operationTimestamp(createdAt);
  return auditLogs
    .filter((log) => log.action === action && matchesDetails(log.details ?? ""))
    .map((log) => ({ log, delta: Math.abs(operationTimestamp(log.createdAt) - operationTime) }))
    .sort((first, second) => first.delta - second.delta)[0]?.log;
}

export function isSessionAuditAction(action: string) {
  const normalizedAction = action
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return ["connexion", "deconnexion", "login", "logout", "sign in", "sign out"].some((sessionAction) => normalizedAction.includes(sessionAction));
}

export function createAuditLog(
  user: AppUser,
  schoolId: string,
  schoolYearId: string,
  action: string,
  details: string,
  createId: (prefix: string) => string,
): AuditLog {
  return {
    id: createId("audit"),
    schoolId,
    schoolYearId,
    actorId: user.id,
    actorName: user.name,
    action,
    details,
    createdAt: new Date().toISOString(),
  };
}
