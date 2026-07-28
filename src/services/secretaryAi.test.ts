import { describe, expect, it } from "vitest";
import { aiErrorMessage } from "./secretaryAi";

function callableError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

describe("messages d'erreur de l'Assistant IA", () => {
  it("affiche un message serveur exploitable", () => {
    expect(aiErrorMessage(callableError("functions/resource-exhausted", "La limite OpenAI est temporairement atteinte."))).toBe("La limite OpenAI est temporairement atteinte.");
  });

  it("ne montre pas un message technique générique", () => {
    expect(aiErrorMessage(callableError("functions/internal", "internal"))).toContain("temporairement indisponible");
  });

  it("conserve les erreurs d'authentification compréhensibles", () => {
    expect(aiErrorMessage(callableError("functions/unauthenticated", "Unauthenticated"))).toContain("session a expiré");
  });
});
