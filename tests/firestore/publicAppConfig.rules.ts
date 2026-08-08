import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const projectId = "demo-acadea-public-app-config";
let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "publicConfig", "appConfig"), { loginLogoUrl: "https://example.invalid/logo.png", updatedAt: "2026-08-08T00:00:00.000Z" });
    await setDoc(doc(context.firestore(), "platform", "appConfig"), { loginLogoUrl: "legacy", privateApiEndpoint: "internal-only", updatedAt: "2026-08-01T00:00:00.000Z" });
  });
});

afterAll(async () => environment.cleanup());

describe("SEC-017 — configuration publique strictement bornée", () => {
  it("permet la lecture anonyme du document public et du logo uniquement", async () => {
    const snapshot = await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), "publicConfig", "appConfig")));
    expect(snapshot.data()).toEqual({ loginLogoUrl: "https://example.invalid/logo.png", updatedAt: "2026-08-08T00:00:00.000Z" });
  });

  it("n'expose pas le document historique contenant un champ privé simulé", async () => {
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "platform", "appConfig")));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext("super", { role: "super_admin" }).firestore(), "platform", "appConfig")));
  });

  it("refuse toute écriture publique ou provenant d'un rôle non autorisé", async () => {
    await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), "publicConfig", "appConfig"), { loginLogoUrl: "x", updatedAt: "now" }));
    await assertFails(setDoc(doc(environment.authenticatedContext("admin", { role: "school_admin", schoolId: "school-a" }).firestore(), "publicConfig", "appConfig"), { loginLogoUrl: "x", updatedAt: "now" }));
  });

  it("autorise le Super Administrateur avec le schéma exact", async () => {
    const db = environment.authenticatedContext("super", { role: "super_admin" }).firestore();
    await assertSucceeds(setDoc(doc(db, "publicConfig", "appConfig"), { loginLogoUrl: "https://example.invalid/new-logo.png", updatedAt: "2026-08-08T01:00:00.000Z" }));
  });

  it("refuse les clés inattendues même au Super Administrateur", async () => {
    const db = environment.authenticatedContext("super", { role: "super_admin" }).firestore();
    await assertFails(setDoc(doc(db, "publicConfig", "appConfig"), { loginLogoUrl: "x", updatedAt: "now", secret: "interdit" }));
  });
});
