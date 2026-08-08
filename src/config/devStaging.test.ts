import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const launcher = readFileSync("scripts/devStaging.cjs", "utf8");
const require = createRequire(import.meta.url);
const {
  mergeStagingEnvironment,
  selectLocalServerEnvironment,
  validateStagingEnvironment,
} = require("../../scripts/devStaging.cjs") as {
  mergeStagingEnvironment: (sources: Record<string, Record<string, string>>) => Record<string, string>;
  selectLocalServerEnvironment: (values: Record<string, string>) => Record<string, string>;
  validateStagingEnvironment: (environment: Record<string, string>) => void;
};

const credential = (projectId: string) => JSON.stringify({
  project_id: projectId,
  private_key: "test-only-not-a-real-key",
});

describe("serveur de développement Staging", () => {
  it("utilise Vercel Dev comme serveur frontend et API unique", () => {
    expect(packageJson.scripts.dev).toBe("npm run dev:staging");
    expect(packageJson.scripts["dev:staging"]).toBe("node scripts/devStaging.cjs");
    expect(launcher).toContain('[vercelCli, "dev", "--listen", "127.0.0.1:5173"]');
  });

  it("accepte uniquement un credential Admin acadea-staging", () => {
    expect(() => validateStagingEnvironment({
      VITE_FIREBASE_PROJECT_ID: "acadea-staging",
      FIREBASE_SERVICE_ACCOUNT_JSON: credential("acadea-staging"),
    })).not.toThrow();
    expect(() => validateStagingEnvironment({
      VITE_FIREBASE_PROJECT_ID: "acadea-staging",
      FIREBASE_SERVICE_ACCOUNT_JSON: credential("acadea-production"),
    })).toThrow("Credential refusé : projet Firebase inattendu.");
    expect(() => validateStagingEnvironment({
      VITE_FIREBASE_PROJECT_ID: "acadea-production",
      FIREBASE_SERVICE_ACCOUNT_JSON: credential("acadea-staging"),
    })).toThrow("la configuration Firebase doit cibler acadea-staging");
  });

  it("refuse proprement un credential absent ou invalide", () => {
    expect(() => validateStagingEnvironment({ VITE_FIREBASE_PROJECT_ID: "acadea-staging" }))
      .toThrow("Credential Firebase Admin Staging introuvable. Ajoutez-le dans .env.staging.local.");
    expect(() => validateStagingEnvironment({
      VITE_FIREBASE_PROJECT_ID: "acadea-staging",
      FIREBASE_SERVICE_ACCOUNT_JSON: "{invalide",
    })).toThrow("Credential Firebase Admin Staging invalide.");
  });

  it("respecte la priorité shell, staging local, local, staging puis base", () => {
    const environment = mergeStagingEnvironment({
      baseEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("base") },
      stagingEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("staging") },
      localEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("local") },
      stagingLocalEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("staging-local") },
      processEnvironment: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("acadea-staging") },
    });
    expect(JSON.parse(environment.FIREBASE_SERVICE_ACCOUNT_JSON).project_id).toBe("acadea-staging");

    const withoutShellOverride = mergeStagingEnvironment({
      baseEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("base") },
      stagingEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("staging") },
      localEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("local") },
      stagingLocalEnv: { FIREBASE_SERVICE_ACCOUNT_JSON: credential("staging-local") },
    });
    expect(JSON.parse(withoutShellOverride.FIREBASE_SERVICE_ACCOUNT_JSON).project_id).toBe("staging-local");
  });

  it("charge un credential multiligne Staging côté serveur sans propager les identifiants E2E", () => {
    const multilineCredential = `{
      "project_id": "acadea-staging",
      "private_key": "test-only-not-a-real-key"
    }`;
    const parsedStagingLocal = parse(`FIREBASE_SERVICE_ACCOUNT_JSON='${multilineCredential}'`);
    const environment = mergeStagingEnvironment({
      stagingLocalEnv: parsedStagingLocal,
      processEnvironment: { VITE_FIREBASE_PROJECT_ID: "acadea-staging" },
    });
    expect(environment.FIREBASE_SERVICE_ACCOUNT_JSON).toBe(multilineCredential);
    expect(selectLocalServerEnvironment({
      E2E_CASHIER_EMAIL: "not-forwarded@example.test",
      FIREBASE_SERVICE_ACCOUNT_JSON: multilineCredential,
    })).not.toHaveProperty("E2E_CASHIER_EMAIL");
  });

  it("ne rend jamais le credential Firebase Admin disponible via une variable Vite", () => {
    expect(launcher).not.toContain("VITE_FIREBASE_SERVICE_ACCOUNT_JSON");
    expect(selectLocalServerEnvironment({
      FIREBASE_SERVICE_ACCOUNT_JSON: credential("acadea-staging"),
    })).not.toHaveProperty("VITE_FIREBASE_SERVICE_ACCOUNT_JSON");
  });
});
