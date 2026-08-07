import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sanitizeValveAttachmentDisplayName } from "./valvesStorage";

describe("noms des pieces jointes Valves", () => {
  it("retire les separateurs, controles et limite le nom affiche", () => {
    const sanitized = sanitizeValveAttachmentDisplayName(`../dossier\\${String.fromCharCode(0)}rapport.pdf`);
    expect(sanitized).not.toContain("/");
    expect(sanitized).not.toContain("\\");
    expect(sanitized).not.toContain(String.fromCharCode(0));
    expect(sanitized.length).toBeLessThanOrEqual(120);
  });

  it("valide le fichier avant de demarrer l'upload Storage", () => {
    const source = readFileSync(new URL("./valvesStorage.ts", import.meta.url), "utf8");
    const validation = source.indexOf("const validationError = validateValveAttachments");
    const upload = source.indexOf("uploadBytesResumable(", validation);
    expect(validation).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(validation);
  });

  it("supprime les fichiers deja uploades si une serie echoue", () => {
    const source = readFileSync(new URL("./valvesStorage.ts", import.meta.url), "utf8");
    expect(source).toContain("await deleteValveAttachments(uploadedAttachments.map((attachment) => attachment.path))");
  });
});
