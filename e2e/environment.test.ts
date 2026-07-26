import { describe, expect, it } from "vitest";
import { assertSafeE2EEnvironment } from "./support/environment";
import { uniqueTestId } from "./support/test-data";

describe("garde-fou E2E", () => {
  it("autorise uniquement Staging", () => {
    expect(assertSafeE2EEnvironment({ ACADEA_E2E_BASE_URL: "https://acadea-staging.vercel.app", VITE_FIREBASE_PROJECT_ID: "acadea-staging" })).toEqual({
      baseUrl: "https://acadea-staging.vercel.app",
      firebaseProjectId: "acadea-staging",
    });
  });

  it("refuse explicitement Production", () => {
    expect(() => assertSafeE2EEnvironment({ ACADEA_E2E_BASE_URL: "https://acadea-production.vercel.app", VITE_FIREBASE_PROJECT_ID: "acadea-production" })).toThrow(/Production/);
  });

  it("préfixe toutes les données créées", () => {
    expect(uniqueTestId("school-a")).toMatch(/^e2e-\d+-[a-f0-9]{8}-school-a$/);
  });
});
