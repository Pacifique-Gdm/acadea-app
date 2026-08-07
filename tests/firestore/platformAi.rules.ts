import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let environment: RulesTestEnvironment | undefined;
const projectId = "demo-acadea-platform-ai";
const env = () => { if (!environment) throw new Error("Environnement indisponible."); return environment; };
const superAdmin = () => env().authenticatedContext("super-1", { role: "super_admin" }).firestore();
const schoolAdmin = () => env().authenticatedContext("admin-1", { role: "school_admin", schoolId: "school-a" }).firestore();

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await env().clearFirestore();
  await env().withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "schools", "school-a"), { id: "school-a", aiAssistant: { enabled: true, monthlyLimit: 50, monthlyUsage: 17, usageMonth: "2026-08", updatedAt: new Date(), updatedBy: "system" } });
    await setDoc(doc(context.firestore(), "schools", "school-b"), { id: "school-b", aiAssistant: { enabled: false, monthlyLimit: 25, monthlyUsage: 9, usageMonth: "2026-08", updatedAt: new Date(), updatedBy: "system" } });
  });
});
afterAll(async () => environment?.cleanup(), 30_000);

describe("contrôles Super Administrateur de l’Assistant IA", () => {
  it("interdit tout reset direct, y compris au Super Administrateur", async () => {
    await assertFails(updateDoc(doc(schoolAdmin(), "schools", "school-a"), { "aiAssistant.monthlyUsage": 0, "aiAssistant.usageMonth": "2026-08", "aiAssistant.updatedAt": serverTimestamp(), "aiAssistant.updatedBy": "admin-1" }));
    await assertFails(updateDoc(doc(superAdmin(), "schools", "school-a"), { "aiAssistant.monthlyUsage": 0, "aiAssistant.usageMonth": "2026-08", "aiAssistant.updatedAt": serverTimestamp(), "aiAssistant.updatedBy": "super-1" }));
    const schoolA = (await getDoc(doc(superAdmin(), "schools", "school-a"))).data()?.aiAssistant;
    const schoolB = (await getDoc(doc(superAdmin(), "schools", "school-b"))).data()?.aiAssistant;
    expect(schoolA).toMatchObject({ enabled: true, monthlyLimit: 50, monthlyUsage: 17 });
    expect(schoolB).toMatchObject({ enabled: false, monthlyLimit: 25, monthlyUsage: 9 });
  });

  it("refuse toute modification arbitraire du compteur et autorise l'audit Super Administrateur", async () => {
    await assertFails(updateDoc(doc(superAdmin(), "schools", "school-a"), { "aiAssistant.monthlyUsage": 3, "aiAssistant.updatedAt": serverTimestamp(), "aiAssistant.updatedBy": "super-1" }));
    await assertFails(setDoc(doc(superAdmin(), "auditLogs", "audit-ai"), { id: "audit-ai", schoolId: "school-a", actorId: "super-1", actorName: "Super Admin", action: "Réinitialisation du quota mensuel de l’Assistant IA", details: "Ancienne consommation : 17. Nouvelle consommation : 0.", createdAt: serverTimestamp() }));
  });

  it("interdit les reservations IA a tous les clients", async () => {
    await assertFails(setDoc(doc(superAdmin(), "schools", "school-a", "aiUsageReservations", "request-a"), { schoolId: "school-a", userId: "super-1", status: "reserved" }));
    await assertFails(setDoc(doc(schoolAdmin(), "schools", "school-a", "aiUsageReservations", "request-b"), { schoolId: "school-a", userId: "admin-1", status: "reserved" }));
  });
});
