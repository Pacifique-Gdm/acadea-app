import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

export const FUNCTION_AUDIT_EVENTS = {
  AI_ENABLED: "ai.enabled", AI_DISABLED: "ai.disabled", AI_LIMIT_UPDATED: "ai.limit.updated", AI_QUOTA_RESET: "ai.quota.reset",
  DISCIPLINE_SANCTION_CREATED: "discipline.sanction.created", DISCIPLINE_SANCTION_COMPLETED: "discipline.sanction.completed",
  CORRESPONDENCE_DELETED: "secretary.correspondence.deleted", REPORT_DELETED: "secretary.report.deleted",
} as const;

type EventType = typeof FUNCTION_AUDIT_EVENTS[keyof typeof FUNCTION_AUDIT_EVENTS];
type Actor = { uid: string; role: string; name?: string };

export function functionServerAudit(input: { eventType: EventType; actor: Actor; schoolId: string; schoolYearId?: string; resourceType: string; resourceId: string; metadata?: Record<string, string | number | boolean>; id?: string }) {
  return { id: input.id ?? randomUUID(), eventType: input.eventType, actorId: input.actor.uid, actorRole: input.actor.role, actorName: input.actor.name ?? input.actor.uid, schoolId: input.schoolId, ...(input.schoolYearId ? { schoolYearId: input.schoolYearId } : {}), resourceType: input.resourceType, resourceId: input.resourceId, source: "server", metadata: input.metadata ?? {}, action: input.eventType, details: input.eventType, createdAt: FieldValue.serverTimestamp() };
}
