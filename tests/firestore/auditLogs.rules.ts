import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let environment: RulesTestEnvironment | undefined;
const env = () => { if (!environment) throw new Error("Emulator absent"); return environment; };
const auth = (uid: string, role: string, schoolId?: string) => env().authenticatedContext(uid, { role, ...(schoolId ? { schoolId } : {}) }).firestore();
const forged = { id: "forged", eventType: "school.created", actorId: "super-admin", actorRole: "super_admin", schoolId: "school-a", resourceType: "school", resourceId: "school-a", source: "server", createdAt: serverTimestamp() };

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-acadea-audit", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await env().clearFirestore();
  await env().withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "auditLogs", "legacy-a"), { id: "legacy-a", schoolId: "school-a", actorId: "old", actorName: "Ancien", action: "Ancienne action", createdAt: "2025-01-01" });
    await setDoc(doc(context.firestore(), "auditLogs", "canonical-a"), { ...forged, id: "canonical-a", actorId: "server", createdAt: new Date() });
    await setDoc(doc(context.firestore(), "auditLogs", "canonical-b"), { ...forged, id: "canonical-b", actorId: "server", schoolId: "school-b", resourceId: "school-b", createdAt: new Date() });
    await setDoc(doc(context.firestore(), "auditLogs", "secretary-own"), { ...forged, id: "secretary-own", schoolId: "school-a", schoolYearId: "year-a", actorId: "secretary", actorRole: "secretary", createdAt: new Date() });
    await setDoc(doc(context.firestore(), "auditLogs", "cashier-own"), { ...forged, id: "cashier-own", schoolId: "school-a", schoolYearId: "year-a", actorId: "cashier", actorRole: "cashier", createdAt: new Date() });
    await setDoc(doc(context.firestore(), "auditLogs", "cashier-legacy"), { id: "cashier-legacy", schoolId: "school-a", actorId: "cashier", actorName: "Caissier", action: "Ancien paiement", createdAt: "2025-01-01" });
    await setDoc(doc(context.firestore(), "users", "cashier"), { id: "cashier", schoolId: "school-a", role: "cashier", status: "active", active: true });
  });
});
afterAll(async () => environment?.cleanup(), 30_000);

describe("SEC-005 audit immuable", () => {
  for (const [label, firestore] of [
    ["non authentifié", () => env().unauthenticatedContext().firestore()],
    ["secrétaire", () => auth("secretary", "secretary", "school-a")],
    ["caissier", () => auth("cashier", "cashier", "school-a")],
    ["administrateur", () => auth("admin", "school_admin", "school-a")],
    ["Super Administrateur", () => auth("super", "super_admin")],
  ] as const) it(`refuse la création falsifiée par ${label}`, async () => assertFails(setDoc(doc(firestore(), "auditLogs", `forged-${label}`), forged)));

  it("refuse modification et suppression", async () => {
    const admin = auth("admin", "school_admin", "school-a");
    await assertFails(updateDoc(doc(admin, "auditLogs", "canonical-a"), { actorId: "admin" }));
    await assertFails(deleteDoc(doc(admin, "auditLogs", "canonical-a")));
  });
  it("autorise l'administrateur à lire son école et les anciens logs", async () => {
    const admin = auth("admin", "school_admin", "school-a");
    await assertSucceeds(getDoc(doc(admin, "auditLogs", "canonical-a")));
    await assertSucceeds(getDoc(doc(admin, "auditLogs", "legacy-a")));
  });
  it("refuse la lecture inter-écoles", async () => assertFails(getDoc(doc(auth("admin", "school_admin", "school-a"), "auditLogs", "canonical-b"))));
  it("autorise la lecture globale au Super Administrateur", async () => assertSucceeds(getDoc(doc(auth("super", "super_admin"), "auditLogs", "canonical-b"))));
  it("autorise le Secrétaire à interroger uniquement ses propres audits tenantés", async () => {
    const secretary = auth("secretary", "secretary", "school-a");
    await assertSucceeds(getDocs(query(collection(secretary, "auditLogs"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "year-a"), where("actorId", "==", "secretary"))));
    await assertFails(getDoc(doc(secretary, "auditLogs", "canonical-a")));
    await assertFails(getDoc(doc(auth("secretary", "secretary", "school-b"), "auditLogs", "secretary-own")));
  });
  it("autorise le Caissier à lire uniquement ses propres audits, y compris legacy", async () => {
    const cashier = auth("cashier", "cashier", "school-a");
    const own = await assertSucceeds(getDocs(query(collection(cashier, "auditLogs"), where("schoolId", "==", "school-a"), where("actorId", "==", "cashier"))));
    expect(own.docs.map((item) => item.id).sort()).toEqual(["cashier-legacy", "cashier-own"]);
    await assertFails(getDoc(doc(cashier, "auditLogs", "secretary-own")));
    await assertFails(getDoc(doc(auth("cashier", "cashier", "school-b"), "auditLogs", "cashier-own")));
  });
  it("refuse les audits personnels à un Caissier inactif", async () => {
    await env().withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), "users", "cashier"), { status: "inactive", active: false }));
    await assertFails(getDoc(doc(auth("cashier", "cashier", "school-a"), "auditLogs", "cashier-own")));
  });

  it("interdit toute lecture ou écriture des compteurs techniques, y compris au Super Administrateur", async () => {
    for (const firestore of [auth("secretary", "secretary", "school-a"), auth("admin", "school_admin", "school-a"), auth("super", "super_admin")]) {
      const reference = doc(firestore, "_rateLimits", "forged");
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { count: 0, resetAt: new Date() }));
      await assertFails(updateDoc(reference, { count: 0 }));
      await assertFails(deleteDoc(reference));
    }
  });
});
