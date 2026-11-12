import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("Study AI callable", () => {
  const source = fs.readFileSync("src/services/studyAi.ts", "utf8");
  it("utilise la callable existante en europe-west1", () => {
    expect(source).toMatch(/getFunctions\(app,\s*"europe-west1"\)/);
    expect(source).toContain('"studyAiAssistant"');
    expect(source).toMatch(/timeout:\s*60000/);
  });
  it("vérifie rôle, session et école avant réseau", () => {
    expect(source).toMatch(/user\.role\s*!==\s*"study_director"/);
    expect(source).toMatch(/user\.schoolId\s*!==\s*input\.schoolId/);
    expect(source).toMatch(/auth\.currentUser\.uid\s*!==\s*user\.id/);
    expect(source.indexOf("Action IA non autorisée.")).toBeLessThan(source.indexOf("const callable"));
  });
  it("ne contient aucun secret", () => expect(source).not.toMatch(/OPENAI_API_KEY|Bearer /));
});
