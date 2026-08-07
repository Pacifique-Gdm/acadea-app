import { describe, expect, it } from "vitest";
import { assertSecretaryAiIdentity, assertSecretaryAiProfile } from "./schoolAiAccess.js";

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
  it("refuse un role non autorise", () => {
    expect(() => assertSecretaryAiIdentity({ uid: "admin-1", token: { role: "school_admin", schoolId: "school-1" } }, "school-1")).toThrow(expect.objectContaining({ code: "permission-denied" }));
  });

  it("exige un profil Secretaire actif dans la meme ecole", () => {
    expect(() => assertSecretaryAiProfile({ id: "secretary-1", role: "secretary", schoolId: "school-1", status: "active" }, "secretary-1", "school-1")).not.toThrow();
    expect(() => assertSecretaryAiProfile({ id: "secretary-1", role: "secretary", schoolId: "school-2", status: "active" }, "secretary-1", "school-1")).toThrow(expect.objectContaining({ code: "permission-denied" }));
    expect(() => assertSecretaryAiProfile({ id: "secretary-1", role: "secretary", schoolId: "school-1", status: "inactive" }, "secretary-1", "school-1")).toThrow(expect.objectContaining({ code: "permission-denied" }));
  });
});
