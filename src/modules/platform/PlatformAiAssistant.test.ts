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
    expect(service).toContain('"aiAssistant.updatedAt": serverTimestamp()');
    expect(service).toContain('"aiAssistant.updatedBy": user.id');
  });

  it("confirme strictement l'activation et la désactivation avant sauvegarde", () => {
    expect(platform).toContain('"Activation" : "Désactivation"');
    expect(platform).toContain(" de l'Assistant IA");
    expect(platform).toContain("canConfirmAiAssistantChange(aiAssistantConfirmation");
    expect(platform).toContain("saveSchoolAiAssistantSetting(user, school, { enabled })");
    expect(platform).toContain('enabled ? "activé" : "désactivé"');
  });

  it("réinitialise la phrase lors de l'annulation et après succès", () => {
    const closeStart = platform.indexOf("function closeSchoolAiAssistantConfirmation");
    const confirmStart = platform.indexOf("async function confirmSchoolAiAssistantChange");
    expect(platform.slice(closeStart, confirmStart)).toContain('setAiAssistantConfirmation("")');
    expect(platform.slice(confirmStart, platform.indexOf("function openAdminRemovalDialog"))).toContain('setAiAssistantConfirmation("")');
  });

  it("interdit explicitement aux administrateurs d'école de modifier le paramètre", () => {
    expect(rules).toContain('affectedKeys().hasAny(["aiAssistant"])');
  });

  it("affiche, valide et sauvegarde le quota mensuel", () => {
    expect(platform).toContain("Quota mensuel");
    expect(platform).toContain("Utilisation ce mois");
    expect(platform).toContain('min="1"');
    expect(platform).toContain('max="1000"');
    expect(platform).toContain("validateSchoolAiMonthlyLimit");
    expect(platform).toContain("saveSchoolAiMonthlyLimit");
  });

  it("réserve les compteurs aux Functions dans les règles", () => {
    expect(rules).toContain("request.resource.data.aiAssistant.monthlyUsage == resource.data.aiAssistant.monthlyUsage");
    expect(rules).toContain("request.resource.data.aiAssistant.usageMonth == resource.data.aiAssistant.usageMonth");
  });
});
