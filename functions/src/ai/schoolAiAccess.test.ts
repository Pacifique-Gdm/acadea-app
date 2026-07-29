import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assertSecretaryAiEnabled } from "./schoolAiAccess.js";

const auth = { uid: "secretary-1", token: { role: "secretary", schoolId: "school-1" } };
const readSchool = (data?: Record<string, unknown>, exists = true) => vi.fn(async () => ({ exists, data }));

describe("accès backend à l’Assistant IA", () => {
  it("continue uniquement lorsque l’IA est activée", async () => {
    const reader = readSchool({ aiAssistant: { enabled: true } });
    await expect(assertSecretaryAiEnabled(auth, "school-1", reader)).resolves.toMatchObject({ aiAssistant: { enabled: true } });
    expect(reader).toHaveBeenCalledOnce();
  });

  it.each([["désactivée", { aiAssistant: { enabled: false } }], ["absente", {}]])("refuse lorsque la configuration est %s", async (_label, data) => {
    await expect(assertSecretaryAiEnabled(auth, "school-1", readSchool(data))).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("refuse une école introuvable", async () => {
    await expect(assertSecretaryAiEnabled(auth, "school-1", readSchool(undefined, false))).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuse un utilisateur non authentifié", async () => {
    const reader = readSchool({ aiAssistant: { enabled: true } });
    await expect(assertSecretaryAiEnabled(null, "school-1", reader)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("refuse une autre école avant toute lecture et donc avant OpenAI", async () => {
    const reader = readSchool({ aiAssistant: { enabled: true } });
    await expect(assertSecretaryAiEnabled(auth, "school-2", reader)).rejects.toMatchObject({ code: "permission-denied" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("exécute le garde partagé avant tout appel OpenAI et pour la décision", () => {
    const handler = readFileSync(new URL("./writingAssistant.ts", import.meta.url), "utf8");
    expect(handler.indexOf("await assertSecretaryAiEnabled")).toBeLessThan(handler.indexOf('fetch("https://api.openai.com'));
    expect(handler.match(/await assertSecretaryAiEnabled/g)).toHaveLength(2);
  });
});
