import { Firestore } from "@google-cloud/firestore";
import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { managePersonnel } from "../../api/provision-school-account.js";

const projectId = process.env.GCLOUD_PROJECT || "demo-personnel-concurrency";
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const db = new Firestore({ projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false, credentials: { client_email: "emulator@localhost", private_key: privateKey } });
const schoolId = "school-concurrent";
const caller = { uid: "admin-concurrent", role: "school_admin", schoolId };
const auth = { getUser: vi.fn(async (uid: string) => ({ uid, email: `${uid}@example.test`, displayName: uid })), updateUser: vi.fn(async () => undefined) };

async function save(personnelId: string) {
  return managePersonnel({ auth, db, caller, action: "update-personnel", body: { schoolId, personnelId, name: personnelId, phone: "0990000000", email: `${personnelId}@example.test`, sectionIds: ["Primaire"], profile: { birthPlace: "Kinshasa" } } });
}

describe("allocation concurrente réelle des matricules", () => {
  beforeAll(async () => {
    await db.doc(`schools/${schoolId}`).set({ id: schoolId, educationLevels: ["Primaire"], status: "active" });
    await db.doc(`users/${caller.uid}`).set({ id: caller.uid, role: "school_admin", schoolId, status: "active", active: true });
    await Promise.all(["personnel-a", "personnel-b"].map((id) => db.doc(`users/${id}`).set({ id, role: "teacher", schoolId, status: "active", active: true, createdAt: "2024-01-01T00:00:00.000Z" })));
  }, 30_000);
  it("sérialise deux premières sauvegardes simultanées et stabilise une nouvelle sauvegarde", async () => {
    await Promise.all([save("personnel-a"), save("personnel-b")]);
    const [profileA, profileB, counter] = await Promise.all([db.doc("personnelProfiles/personnel-a").get(), db.doc("personnelProfiles/personnel-b").get(), db.doc(`schools/${schoolId}/counters/personnelMatricules`).get()]);
    const matricules = [profileA.data()?.matricule, profileB.data()?.matricule].sort();
    expect(matricules).toEqual(["PER-000001", "PER-000002"]);
    expect(counter.data()?.lastNumber).toBe(2);
    await Promise.all([save("personnel-a"), save("personnel-a")]);
    expect((await db.doc("personnelProfiles/personnel-a").get()).data()?.matricule).toBe(profileA.data()?.matricule);
    expect((await db.doc(`schools/${schoolId}/counters/personnelMatricules`).get()).data()?.lastNumber).toBe(2);
  }, 30_000);
});
