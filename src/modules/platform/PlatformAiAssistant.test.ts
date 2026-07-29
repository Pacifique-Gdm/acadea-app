import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("contrôle Super Administrateur de l’Assistant IA", () => {
  const platform = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../services/schoolAiAssistant.ts", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8");

  it("affiche le statut, l'interrupteur et les retours de sauvegarde", () => {
    expect(platform).toContain("Assistant IA — Module Secrétaire");
    expect(platform).toContain('role="switch"');
    expect(platform).toContain('"Activé" : "Désactivé"');
    expect(platform).toContain("aiAssistantSaving");
    expect(platform).toContain("aiAssistantError");
  });

  it("enregistre un Timestamp serveur et l'identité du Super Administrateur", () => {
    expect(service).toContain('user.role !== "super_admin"');
    expect(service).toContain("updatedAt: serverTimestamp()");
    expect(service).toContain("updatedBy: user.id");
  });

  it("interdit explicitement aux administrateurs d'école de modifier le paramètre", () => {
    expect(rules).toContain('affectedKeys().hasAny(["aiAssistant"])');
  });
});
