import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES, buildServerAudit, sanitizeAuditMetadata } from "./serverAudit.js";

describe("SEC-005 audit serveur", () => {
  it("impose acteur, tenant, source et type canonique", () => {
    const audit = buildServerAudit({ eventType: AUDIT_EVENT_TYPES.USER_CREATED, actor: { uid: "admin-a", role: "school_admin", name: "Admin" }, schoolId: "school-a", resourceType: "user", resourceId: "user-a" });
    expect(audit).toMatchObject({ eventType: "user.created", actorId: "admin-a", actorRole: "school_admin", schoolId: "school-a", resourceType: "user", resourceId: "user-a", source: "server" });
    expect(audit.createdAt).toBeTruthy();
  });
  it("refuse les types libres", () => expect(() => buildServerAudit({ eventType: "forged.event", actor: { uid: "a", role: "x" }, schoolId: "s", resourceType: "x", resourceId: "x" })).toThrow("non autorisé"));
  it("supprime les métadonnées sensibles", () => expect(sanitizeAuditMetadata({ password: "secret", tokenFirebase: "token", prompt: "texte", amount: 10, status: "ok" })).toEqual({ amount: 10, status: "ok" }));
  it("refuse un contexte incomplet", () => expect(() => buildServerAudit({ eventType: AUDIT_EVENT_TYPES.USER_CREATED, actor: { uid: "", role: "" }, schoolId: "", resourceType: "", resourceId: "" })).toThrow("incomplet"));
});
