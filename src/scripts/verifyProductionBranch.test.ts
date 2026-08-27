import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { PROOF_FILE, assertTrustedMain, readCliProof, verifyProductionSource } = require("../../scripts/verifyProductionBranch.cjs") as {
  PROOF_FILE: string;
  assertTrustedMain: (state: { branch: string; head?: string; originMain?: string; clean?: boolean }, source: string, options?: { requireClean?: boolean }) => void;
  readCliProof: (cwd: string, now?: number) => Record<string, unknown> | null;
  verifyProductionSource: (options: { cwd: string; env: Record<string, string>; target?: string; now?: number }) => { source: string; branch: string; sha?: string };
};
const directories: string[] = [];
const temporaryDirectory = () => { const path = mkdtempSync(join(tmpdir(), "acadea-production-branch-")); directories.push(path); return path; };
const sha = "48c20dd1f5482dda1e9e02568da5b44a4b1f0111";

afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("garde-fou de déploiement Production", () => {
  it("autorise un dépôt local main synchronisé et refuse sa branche feature", () => {
    const cwd = temporaryDirectory();
    const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
    git("init", "-b", "main"); git("config", "user.email", "test@acadea.invalid"); git("config", "user.name", "Acadéa Test");
    writeFileSync(join(cwd, "README.md"), "test\n"); git("add", "README.md"); git("commit", "-m", "test"); git("update-ref", "refs/remotes/origin/main", "HEAD");
    expect(verifyProductionSource({ cwd, env: {}, target: "production" }).source).toBe("local-git");
    git("switch", "-c", "feature/test");
    expect(() => verifyProductionSource({ cwd, env: {}, target: "production" })).toThrow('is not "main"');
  }, 15_000);
  it("autorise VERCEL_GIT_COMMIT_REF=main et refuse feature/test", () => {
    expect(verifyProductionSource({ cwd: temporaryDirectory(), env: { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: sha } }).source).toBe("vercel-git");
    expect(() => verifyProductionSource({ cwd: temporaryDirectory(), env: { VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feature/test", VERCEL_GIT_COMMIT_SHA: sha } })).toThrow('is not "main"');
  });
  it("refuse l’absence de toute information fiable", () => {
    expect(() => verifyProductionSource({ cwd: temporaryDirectory(), env: { VERCEL: "1", VERCEL_ENV: "production" } })).toThrow("no trustworthy Git branch information");
  });
  it("refuse la divergence HEAD/origin-main", () => {
    expect(() => assertTrustedMain({ branch: "main", head: sha, originMain: "a".repeat(40), clean: true }, "test")).toThrow("does not match origin/main");
  });
  it("accepte uniquement une preuve CLI récente, main et non ambiguë", () => {
    const cwd = temporaryDirectory();
    const now = Date.now();
    writeFileSync(join(cwd, PROOF_FILE), JSON.stringify({ version: 1, target: "production", branch: "main", head: sha, originMain: sha, generatedAt: new Date(now).toISOString() }));
    expect(readCliProof(cwd, now)).toMatchObject({ branch: "main", head: sha });
    expect(verifyProductionSource({ cwd, env: { VERCEL: "1", VERCEL_ENV: "production" }, now }).source).toBe("vercel-cli-proof");
  });
  it("refuse une preuve CLI périmée ou forgée sur une autre branche", () => {
    const cwd = temporaryDirectory();
    writeFileSync(join(cwd, PROOF_FILE), JSON.stringify({ version: 1, target: "production", branch: "feature/test", head: sha, originMain: sha, generatedAt: new Date().toISOString() }));
    expect(readCliProof(cwd)).toBeNull();
    expect(() => verifyProductionSource({ cwd, env: { VERCEL: "1", VERCEL_ENV: "production" } })).toThrow();
  });
});
