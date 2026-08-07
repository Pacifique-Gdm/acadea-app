import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const launcher = readFileSync("scripts/devStaging.cjs", "utf8");

describe("serveur de développement Staging", () => {
  it("utilise Vercel Dev comme serveur frontend et API unique", () => {
    expect(packageJson.scripts.dev).toBe("npm run dev:staging");
    expect(packageJson.scripts["dev:staging"]).toBe("node scripts/devStaging.cjs");
    expect(launcher).toContain('[vercelCli, "dev", "--listen", "127.0.0.1:5173"]');
  });

  it("verrouille Firebase frontend et Admin sur acadea-staging", () => {
    expect(launcher).toContain('environment.VITE_FIREBASE_PROJECT_ID !== "acadea-staging"');
    expect(launcher).toContain("!environment.FIREBASE_SERVICE_ACCOUNT_JSON");
    expect(launcher).toContain('serviceAccount.project_id !== "acadea-staging"');
  });

  it("ne propage pas les identifiants E2E au processus local", () => {
    expect(launcher).not.toContain("E2E_CASHIER_EMAIL");
    expect(launcher).not.toContain("E2E_CASHIER_PASSWORD");
    expect(launcher).not.toContain("...developerLocalEnv");
  });
});
