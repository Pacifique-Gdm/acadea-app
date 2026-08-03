import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/verifyVercelServerEnvironment.cjs");

function verify(target: "staging" | "production", serviceProjectId?: string) {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      VERCEL: "1",
      VITE_APP_ENV: target,
      VITE_FIREBASE_PROJECT_ID: target === "staging" ? "acadea-staging" : "acadea-production",
      FIREBASE_SERVICE_ACCOUNT_JSON: serviceProjectId
        ? JSON.stringify({ project_id: serviceProjectId, client_email: "test@example.invalid", private_key: "not-a-real-key" })
        : "",
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("validation Firebase Admin des déploiements Vercel", () => {
  it("accepte uniquement le compte de service acadea-staging pour Staging", () => {
    expect(verify("staging", "acadea-staging").status).toBe(0);
    const wrongProject = verify("staging", "acadea-production");
    expect(wrongProject.status).toBe(1);
    expect(wrongProject.output).toContain("Firebase Admin project must be acadea-staging");
  });

  it("refuse un déploiement Vercel sans configuration Firebase Admin", () => {
    const result = verify("staging");
    expect(result.status).toBe(1);
    expect(result.output).toContain("FIREBASE_SERVICE_ACCOUNT_JSON is required");
  });

  it("accepte uniquement le compte de service acadea-production pour Production", () => {
    expect(verify("production", "acadea-production").status).toBe(0);
    expect(verify("production", "acadea-staging").status).toBe(1);
  });
});
