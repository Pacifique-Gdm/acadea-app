import { describe, expect, it } from "vitest";
import { assertSecretaryAiIdentity } from "./schoolAiAccess.js";

const auth = { uid: "secretary-1", token: { role: "secretary", schoolId: "school-1" } };

describe("identité de l’Assistant IA", () => {
  it("accepte le Secrétaire de la même école", () => {
    expect(assertSecretaryAiIdentity(auth, "school-1").schoolId).toBe("school-1");
  });

  it("refuse un utilisateur non authentifié", () => {
    expect(() => assertSecretaryAiIdentity(null, "school-1")).toThrow(expect.objectContaining({ code: "unauthenticated" }));
  });

  it("refuse une autre école", () => {
    expect(() => assertSecretaryAiIdentity(auth, "school-2")).toThrow(expect.objectContaining({ code: "permission-denied" }));
  });
});
