import { describe, expect, it } from "vitest";
import { FUNCTION_AUDIT_EVENTS, functionServerAudit } from "./serverAudit.js";

describe("audit canonique Functions", () => {
  it("dérive les champs d'autorité du contexte serveur", () => {
    expect(functionServerAudit({ eventType: FUNCTION_AUDIT_EVENTS.AI_ENABLED, actor: { uid: "super", role: "super_admin" }, schoolId: "school-a", resourceType: "schoolAiAssistant", resourceId: "school-a" })).toMatchObject({ eventType: "ai.enabled", actorId: "super", actorRole: "super_admin", schoolId: "school-a", source: "server" });
  });
  it("ne contient aucun contenu sensible", () => {
    const audit = functionServerAudit({ eventType: FUNCTION_AUDIT_EVENTS.AI_QUOTA_RESET, actor: { uid: "super", role: "super_admin" }, schoolId: "school-a", resourceType: "schoolAiAssistant", resourceId: "school-a", metadata: { monthlyLimit: 25 } });
    expect(JSON.stringify(audit)).not.toMatch(/password|token|prompt|openai/i);
  });
});
