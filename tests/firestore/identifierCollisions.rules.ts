import { readFileSync } from "node:fs";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ db: undefined as unknown, caller: {} as Record<string, string>,
  createUser: vi.fn(), deleteUser: vi.fn(), setCustomUserClaims: vi.fn() }));
vi.mock("../../api/_lib/firebaseAdmin.js", () => ({
  initAdmin: () => ({ db: context.db, auth: { verifyIdToken: async () => context.caller,
    createUser: context.createUser, deleteUser: context.deleteUser, setCustomUserClaims: context.setCustomUserClaims } }),
  firebaseAdminPublicError: () => ({ code: "test-error", message: "Operation refused" }),
}));
// Force collisions in the real handlers; Firestore writes and transactions remain real.
vi.mock("../../api/_lib/randomId.js", () => ({ randomId: (prefix: string) => `${prefix}-a3f9c21b` }));
import createSchool from "../../api/provision-school-admin.js";
import createAccount from "../../api/provision-school-account.js";
import sendParentMessage from "../../api/send-parent-message.js";

let app: App;
let db: Firestore;
let environment: RulesTestEnvironment;
async function invoke(handler: typeof createSchool, body: Record<string, unknown>) {
  const response = { statusCode: 0, setHeader: () => {}, end: () => {} };
  await handler({ method: "POST", headers: { authorization: "Bearer fictitious-emulator-token" }, body }, response);
  return response.statusCode;
}
const schoolBody = { schoolName: "E2E collision", adminName: "Fictitious admin", adminEmail: "fixture@example.test", adminPassword: "emulator-only-unused-password" };

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Local emulator required");
  environment = await initializeTestEnvironment({ projectId: "demo-acadea-id-collisions", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  app = initializeApp({ projectId: "demo-acadea-id-collisions" }, "id-collisions");
  db = getFirestore(app);
  context.db = db;
}, 30000);
beforeEach(async () => {
  await environment.clearFirestore();
  vi.clearAllMocks();
  context.createUser.mockResolvedValue({ uid: "new-auth-fixture" });
  context.deleteUser.mockResolvedValue(undefined);
  context.setCustomUserClaims.mockResolvedValue(undefined);
  context.caller = { uid: "platform-fixture", role: "super_admin" };
  await db.doc("users/platform-fixture").set({ role: "super_admin", status: "active" });
  await db.doc("schools/school-fixture").set({ status: "active" });
  await db.doc("schoolYears/year-fixture").set({ schoolId: "school-fixture", status: "active", name: "2026-2027" });
});
afterAll(async () => { await environment?.cleanup(); if (app) await deleteApp(app); }, 30000);

describe("collision protection in provisioning and messaging handlers", () => {
  it("allows a fresh school through the same handler", async () => {
    expect(await invoke(createSchool, schoolBody)).toBe(200);
  });
  it("allows a fresh Parent through the same handler", async () => {
    context.createUser.mockResolvedValueOnce({ uid: "new-parent-auth" });
    expect(await invoke(createAccount, { role: "parent", schoolId: "school-fixture", schoolYearId: "year-fixture",
      name: "New fixture", email: "parent@example.test", password: "emulator-only-unused-password" })).toBe(200);
  });
  for (const path of ["schools/school-a3f9c21b", "schoolYears/year-a3f9c21b"]) {
    it(`preserves ${path} through creation failure and cleanup`, async () => {
      const existing = { id: path.split("/")[1], untouched: "historical" };
      await db.doc(path).set(existing);
      expect(await invoke(createSchool, schoolBody)).toBe(409);
      expect((await db.doc(path).get()).data()).toEqual(existing);
      if (path.startsWith("schoolYears")) expect((await db.doc("schools/school-a3f9c21b").get()).exists).toBe(false);
      expect(context.createUser).not.toHaveBeenCalled();
    });
  }
  it("cleans only newly created resources after Auth creation fails", async () => {
    await db.doc("schools/preexisting").set({ retained: true });
    context.createUser.mockRejectedValueOnce(new Error("Simulated Auth failure"));
    expect(await invoke(createSchool, schoolBody)).not.toBe(200);
    expect((await db.doc("schools/school-a3f9c21b").get()).exists).toBe(false);
    expect((await db.doc("schoolYears/year-a3f9c21b").get()).exists).toBe(false);
    expect((await db.doc("schools/preexisting").get()).data()).toEqual({ retained: true });
  });
  it("rejects a Parent collision, preserving historical links", async () => {
    const existing = { schoolId: "school-fixture", fullName: "Historical fixture", studentIds: ["retained"] };
    await db.doc("parents/parent-a3f9c21b").set(existing);
    expect(await invoke(createAccount, { role: "parent", schoolId: "school-fixture", schoolYearId: "year-fixture",
      name: "New fixture", email: "parent@example.test", password: "emulator-only-unused-password" })).toBe(409);
    expect((await db.doc("parents/parent-a3f9c21b").get()).data()).toEqual(existing);
    expect(context.createUser).toHaveBeenCalledTimes(1);
    expect(context.deleteUser).toHaveBeenCalledWith("new-auth-fixture");
    expect((await db.doc("users/new-auth-fixture").get()).exists).toBe(false);
  });
  for (const collection of ["messages", "notifications"]) {
    it(`aborts the whole message transaction on a ${collection} collision`, async () => {
      context.caller = { uid: "parent-user", role: "parent", schoolId: "school-fixture", parentId: "parent-fixture" };
      await db.doc("users/parent-user").set({ ...context.caller, status: "active" });
      await db.doc("parents/parent-fixture").set({ schoolId: "school-fixture", userId: "parent-user", status: "active", fullName: "Fictitious parent" });
      await db.doc("users/recipient").set({ role: "school_admin", schoolId: "school-fixture", status: "active" });
      const path = `${collection}/${collection === "messages" ? "msg" : "notif"}-a3f9c21b`;
      await db.doc(path).set({ historical: true });
      expect(await invoke(sendParentMessage, { schoolYearId: "year-fixture", recipientIds: ["recipient"], subject: "Fixture", body: "Local test" })).toBe(409);
      expect((await db.doc(path).get()).data()).toEqual({ historical: true });
      expect((await db.collection("conversations").get()).empty).toBe(true);
      expect((await db.collection("parentDailyMessageLimits").get()).empty).toBe(true);
      await db.doc(path).delete();
      expect(await invoke(sendParentMessage, { schoolYearId: "year-fixture", recipientIds: ["recipient"], subject: "Fixture", body: "Local test" })).toBe(200);
    });
  }
});
