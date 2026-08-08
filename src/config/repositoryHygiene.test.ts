import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SEC-016 — hygiène des artefacts locaux", () => {
  const gitignore = readFileSync(".gitignore", "utf8");
  const firebaseignore = readFileSync(".firebaseignore", "utf8");
  const vercelignore = readFileSync(".vercelignore", "utf8");

  it("ignore explicitement les temporaires, logs et credentials usuels", () => {
    for (const pattern of ["tmp/", "*.log", "service-account*.json", "credentials*.json"]) expect(gitignore).toContain(pattern);
  });

  it("exclut les artefacts sensibles des contextes Firebase et Vercel", () => {
    for (const content of [firebaseignore, vercelignore]) {
      for (const pattern of ["tmp/", "*.log", "service-account*.json", "credentials*.json", "playwright-report/", "test-results/"]) expect(content).toContain(pattern);
    }
  });

  it("ne suit aucun artefact temporaire ou credential commun", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/);
    const sensitive = tracked.filter((path) => /(^|\/)(tmp|temp|diagnostics|emulator-data|local-exports|playwright-report|test-results)(\/|$)|(^|\/)service-account[^/]*\.json$|(^|\/)credentials[^/]*\.json$|\.log$/i.test(path));
    expect(sensitive).toEqual([]);
  });
});
