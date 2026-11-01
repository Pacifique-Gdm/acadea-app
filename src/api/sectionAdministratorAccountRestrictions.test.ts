import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "primary_admin", mutation: vi.fn() }));
vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({
  auth: { createUser: state.mutation, updateUser: state.mutation, deleteUser: state.mutation },
  db: { doc: state.mutation, batch: state.mutation, runTransaction: state.mutation },
}) }));
// Deliberately isolate the permanent action policy from the temporary release gate.
vi.mock("../../api/_lib/activeUser.js", () => ({
  verifyActorIdToken: async () => ({ uid: "section-a", role: state.role, schoolId: "school-a" }),
  requireActiveApiUser: async () => undefined,
}));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: {}, enforceApiRateLimit: vi.fn(), sendRateLimitError: () => false }));
import handler from "../../api/provision-school-account.js";

describe("API — interdiction permanente de gérer les parents et les comptes", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"])("refuse toutes les actions de compte à %s, même sans le verrou de livraison", async (role) => {
    state.role = role;
    state.mutation.mockClear();
    for (const action of ["create", "recover-creation", "delete-parent", "link-parent-to-student", "unlink-parent-from-student",
      "update-personnel", "archive-personnel", "reactivate-personnel", "create-service-personnel", "remove-school-admin", "manage-section-administrator",
      "delete-student", "complete-terminal-student"]) {
      const response = { statusCode: 0, body: "", setHeader: vi.fn(), end(value: string) { this.body = value; } };
      await handler({ method: "POST", headers: { authorization: "Bearer test-token" },
        body: { action, schoolId: "school-a", role: "parent", userId: "section-a", parentId: "parent-a" } }, response);
      expect(response.statusCode, action).toBe(403);
      expect(JSON.parse(response.body)).toMatchObject({ code: "permission-denied" });
    }
    expect(state.mutation).not.toHaveBeenCalled();
  });
});
