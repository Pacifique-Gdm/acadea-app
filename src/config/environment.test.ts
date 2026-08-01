import { describe, expect, it } from "vitest";
import { FIREBASE_PROJECTS, getValidatedFirebaseConfig, validateFirebaseEnvironment } from "./environment";

function config(environment: "staging" | "production") {
  const projectId = FIREBASE_PROJECTS[environment];
  return {
    appEnv: environment,
    projectId,
    apiKey: "public-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    storageBucket: `${projectId}.firebasestorage.app`,
    messagingSenderId: "123",
    appId: "1:123:web:test",
  };
}

describe("validateFirebaseEnvironment", () => {
  it("associe staging uniquement à Firebase Staging", () => {
    expect(validateFirebaseEnvironment(config("staging")).expectedProjectId).toBe("acadea-staging");
  });

  it("associe production uniquement à Firebase Production", () => {
    expect(validateFirebaseEnvironment(config("production")).expectedProjectId).toBe("acadea-production");
  });

  it.each(["staging", "production"] as const)("transmet à initializeApp le projectId validé pour %s", (environment) => {
    const result = getValidatedFirebaseConfig(config(environment));
    expect(result.config.projectId).toBe(FIREBASE_PROJECTS[environment]);
    expect(result.validation.expectedProjectId).toBe(result.config.projectId);
  });

  it.each([
    ["staging", "acadea-production"],
    ["production", "acadea-staging"],
  ] as const)("refuse le mélange %s vers %s", (appEnv, projectId) => {
    expect(() => validateFirebaseEnvironment({ ...config(appEnv), projectId })).toThrow("Configuration Firebase refusée");
  });

  it("refuse une variable Firebase obligatoire absente", () => {
    expect(() => validateFirebaseEnvironment({ ...config("staging"), apiKey: "" })).toThrow("VITE_FIREBASE_API_KEY");
  });

  it("refuse un authDomain ou un bucket appartenant à l'autre environnement", () => {
    expect(() => validateFirebaseEnvironment({ ...config("staging"), authDomain: "acadea-production.firebaseapp.com" })).toThrow("AUTH_DOMAIN");
    expect(() => validateFirebaseEnvironment({ ...config("production"), storageBucket: "acadea-staging.firebasestorage.app" })).toThrow("STORAGE_BUCKET");
  });
});
