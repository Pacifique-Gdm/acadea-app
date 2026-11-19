import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, increment, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const IMAGE = "data:image/webp;base64,QUFBQQ==";

const database = (uid: string, claims: Record<string, unknown>) => environment.authenticatedContext(uid, claims).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const superAdmin = () => database("super-a", { role: "super_admin" });
const parentA = () => database("parent-a", { role: "parent", schoolId: "schoolA" });
const coordinator = () => database("coord-a", { role: "coordination_admin", coordinationId: "c1" });

const campaign = (extra: Record<string, unknown> = {}) => ({
  id: "adTest1", brand: "Marque", linkUrl: "https://exemple.test", startDate: "2026-11-10", endDate: "2026-11-30",
  targetMode: "all", schoolIds: [], coordinationId: "", roles: ["parent"], weight: 1, status: "scheduled",
  desktopVersion: "d", phoneVersion: "p", createdAt: "t", updatedAt: "t", updatedBy: "super-a", ...extra,
});
const stat = (extra: Record<string, unknown> = {}) => ({ campaignId: "adTest1", date: "2026-11-15", shard: 3, ...extra });

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-ad-campaigns", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 120000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed("users/super-a", { id: "super-a", role: "super_admin", status: "active" });
  await seed("users/parent-a", { id: "parent-a", role: "parent", schoolId: "schoolA", status: "active" });
  await seed("schools/schoolA", { id: "schoolA", name: "École A", status: "active" });
  await seed("platformSettings/adsActive", { rotationSeconds: 30, campaigns: [], updatedAt: "t" });
  await seed("adCreatives/adTest1_phone", { campaignId: "adTest1", format: "phone", imageUrl: IMAGE, version: "p", updatedAt: "t" });
});

afterAll(async () => environment?.cleanup(), 30000);

describe("campagnes publicitaires", () => {
  it("tout utilisateur connecté lit la campagne active et l'image ; pas un visiteur anonyme", async () => {
    await assertSucceeds(getDoc(doc(parentA(), "platformSettings", "adsActive")));
    await assertSucceeds(getDoc(doc(parentA(), "adCreatives", "adTest1_phone")));
    await assertSucceeds(getDoc(doc(coordinator(), "platformSettings", "adsActive")));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "platformSettings", "adsActive")));
  });

  it("seul le Super administrateur gère les campagnes et lit les statistiques", async () => {
    await assertSucceeds(setDoc(doc(superAdmin(), "adCampaigns", "adTest1"), campaign()));
    await assertSucceeds(setDoc(doc(superAdmin(), "adCreatives", "adTest1_desktop"), { campaignId: "adTest1", format: "desktop", imageUrl: IMAGE, version: "d", updatedAt: "t" }));
    await assertSucceeds(setDoc(doc(superAdmin(), "platformSettings", "adsActive"), { rotationSeconds: 10, campaigns: [], updatedAt: "t" }));
    await assertSucceeds(getDocs(collection(superAdmin(), "adStats")));
    await assertFails(setDoc(doc(parentA(), "adCampaigns", "adTest2"), campaign({ id: "adTest2" })));
    await assertFails(getDoc(doc(parentA(), "adCampaigns", "adTest1")));
    await assertFails(getDocs(collection(parentA(), "adStats")));
    await assertFails(setDoc(doc(parentA(), "platformSettings", "adsActive"), { rotationSeconds: 30, campaigns: [], updatedAt: "t" }));
  });

  it("refuse une rotation sous 10 secondes, un lien non https ou une part hors limites", async () => {
    await assertFails(setDoc(doc(superAdmin(), "platformSettings", "adsActive"), { rotationSeconds: 5, campaigns: [], updatedAt: "t" }));
    await assertFails(setDoc(doc(superAdmin(), "adCampaigns", "adTest1"), campaign({ linkUrl: "javascript:alert(1)" })));
    await assertFails(setDoc(doc(superAdmin(), "adCampaigns", "adTest1"), campaign({ weight: 11 })));
    await assertFails(setDoc(doc(superAdmin(), "adCreatives", "adTest1_desktop"), { campaignId: "adTest1", format: "desktop", imageUrl: "https://x.test/a.png", version: "d", updatedAt: "t" }));
  });

  it("un parent ajoute ses comptes groupés sur son rôle et son école", async () => {
    const ref = doc(parentA(), "adStats", "adTest1_2026-11-15_3");
    await assertSucceeds(setDoc(ref, stat({ v: increment(12), c: increment(1), vp: increment(12), cp: increment(1), r_parent_v: increment(12), r_parent_c: increment(1), s_schoolA_v: increment(12), s_schoolA_c: increment(1) }), { merge: true }));
    await assertSucceeds(setDoc(ref, stat({ v: increment(4), vd: increment(4), r_parent_v: increment(4), s_schoolA_v: increment(4) }), { merge: true }));
  });

  it("refuse un autre rôle, une autre école, une soustraction ou un chiffre trop grand", async () => {
    const ref = doc(parentA(), "adStats", "adTest1_2026-11-15_3");
    await assertFails(setDoc(ref, stat({ v: increment(1), r_cashier_v: increment(1) }), { merge: true }));
    await assertFails(setDoc(ref, stat({ v: increment(1), s_schoolB_v: increment(1) }), { merge: true }));
    await assertFails(setDoc(ref, stat({ v: increment(5000) }), { merge: true }));
    await assertFails(setDoc(doc(parentA(), "adStats", "autre_nom"), stat({ v: increment(1) }), { merge: true }));
    await assertSucceeds(setDoc(ref, stat({ v: increment(3) }), { merge: true }));
    await assertFails(setDoc(ref, stat({ v: increment(-3) }), { merge: true }));
  });

  it("le coordinateur compte sur le rôle Coordination, sans champ d'école", async () => {
    const ref = doc(coordinator(), "adStats", "adTest1_2026-11-15_7");
    await assertSucceeds(setDoc(ref, stat({ shard: 7, v: increment(2), vd: increment(2), r_coordination_v: increment(2) }), { merge: true }));
    await assertFails(setDoc(ref, stat({ shard: 7, v: increment(1), s_c1_v: increment(1) }), { merge: true }));
  });

  it("le Super administrateur n'envoie pas de comptes (il ne voit jamais de publicité)", async () => {
    await assertFails(setDoc(doc(superAdmin(), "adStats", "adTest1_2026-11-15_3"), stat({ v: increment(1), r_super_admin_v: increment(1) }), { merge: true }));
  });
});
