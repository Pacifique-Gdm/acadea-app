import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Server helper is JavaScript.
import { transactionalMessagingContext } from "./transactionalMessaging.js";
// @ts-expect-error Server helper is JavaScript.
import { requireMessagingCaller } from "./messageRecipients.js";
// @ts-expect-error Server handler is JavaScript.
import { resolveParentMessageRecipients } from "../send-parent-message.js";

const caller = { uid: "p", role: "parent", schoolId: "school", parentId: "parent" };
function fixture(patch: Record<string, unknown> = {}) {
  const docs: Record<string, unknown> = {
    "users/p": { role: "parent", schoolId: "school", parentId: "parent", status: "active" },
    "users/a": { role: "primary_admin", schoolId: "school", status: "active", sectionIds: ["Primaire"] },
    "schools/school": { status: "active" },
    "schoolYears/y": { schoolId: "school", status: "active" },
    "parents/parent": { schoolId: "school", studentIds: ["child", "sibling"] },
    "students/child": { schoolId: "school", schoolYearId: "y", section: "Primaire", status: "ACTIVE" },
    "students/sibling": { schoolId: "school", schoolYearId: "y", section: "Secondaire", status: "ACTIVE" },
    ...patch,
  };
  const snapshot = ({ path }: { path: string }) => ({ id: path.split("/").at(-1), exists: Boolean(docs[path]), data: () => docs[path] });
  const db = { doc: (path: string) => ({ path }) };
  const tx = { get: vi.fn(async (ref) => snapshot(ref)), getAll: vi.fn(async (...refs) => refs.map(snapshot)) };
  return { db, tx };
}
describe("transactional recipient authorization", () => {
  it("retains the verified parentId from API authentication into a bidirectional transaction", async () => {
    const { db, tx } = fixture();
    const profiles: Record<string, unknown> = {
      "users/p": { role: "parent", schoolId: "school", parentId: "parent", status: "active" },
      "schools/school": { status: "active" },
    };
    const auth = { verifyIdToken: vi.fn(async () => caller) };
    const apiDb = { doc: (path: string) => ({ get: async () => ({ exists: Boolean(profiles[path]), data: () => profiles[path] }) }) };
    const verified = await requireMessagingCaller(auth, apiDb, "fixture-token");
    expect(verified.parentId).toBe("parent");
    const context = await transactionalMessagingContext(db, tx, verified, "y");
    await expect(resolveParentMessageRecipients(context.db, context.caller, ["a"], "y", "Primaire")).resolves.toHaveLength(1);
  });
  it("enlists profile, school, year, parent and children in the commit transaction", async () => {
    const { db, tx } = fixture();
    const context = await transactionalMessagingContext(db, tx, caller, "y");
    await expect(resolveParentMessageRecipients(context.db, context.caller, ["a"], "y", "Primaire")).resolves.toHaveLength(1);
    const paths = [...tx.get.mock.calls.flat(), ...tx.getAll.mock.calls.flat()].map((ref) => ref.path);
    for (const path of ["users/p", "users/a", "schools/school", "schoolYears/y", "parents/parent", "students/child", "students/sibling"]) expect(paths).toContain(path);
  });
  it("rejects a reassignment observed on a transaction retry", async () => {
    const { db, tx } = fixture({ "students/child": { schoolId: "school", schoolYearId: "y", section: "Secondaire" } });
    const context = await transactionalMessagingContext(db, tx, caller, "y");
    await expect(resolveParentMessageRecipients(context.db, context.caller, ["a"], "y", "Primaire")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { "users/p": { role: "parent", schoolId: "other", parentId: "parent", status: "active" } },
    { "users/p": { role: "parent", schoolId: "school", parentId: "parent", status: "inactive" } },
    { "schools/school": { status: "suspended" } },
  ])("rejects revoked authority before any writes", async (patch) => {
    const { db, tx } = fixture(patch);
    await expect(transactionalMessagingContext(db, tx, caller, "y")).rejects.toMatchObject({ statusCode: 403 });
  });
});
