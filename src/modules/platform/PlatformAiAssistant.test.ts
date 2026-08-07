import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("contrôle Super Administrateur de l’Assistant IA", () => {
  const platform = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../services/schoolAiAssistant.ts", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8");

  it("affiche le titre simplifié et le statut sur la même ligne", () => {
    expect(platform).toContain('>Assistant IA</h3>');
    expect(platform).not.toContain("Assistant IA — Module Secrétaire");
    expect(platform).toContain("flex flex-wrap items-center justify-between gap-2");
    expect(platform).toContain('"Activé" : "Désactivé"');
    expect(platform).toContain("aiAssistantSaving");
    expect(platform).toContain("aiAssistantError");
  });

  it("enregistre un Timestamp serveur et l'identité du Super Administrateur", () => {
    expect(service).toContain('user.role !== "super_admin"');
    expect(service).toContain('"platformAiUpdateSettings"');
    expect(service).not.toContain('transaction.set(auditRef');
    expect(readFileSync(new URL("../../../functions/src/ai/schoolAiAdmin.ts", import.meta.url), "utf8")).toContain('"aiAssistant.updatedAt": FieldValue.serverTimestamp()');
  });

  it("confirme strictement l'activation et la désactivation avant sauvegarde", () => {
    expect(platform).toContain('"Activation" : "Désactivation"');
    expect(platform).toContain(" de l'Assistant IA");
    expect(platform).toContain("canConfirmAiAssistantChange(aiAssistantConfirmation");
    expect(platform).toContain("saveSchoolAiAssistantSetting(user, school, { enabled })");
    expect(platform).toContain('enabled ? "activé" : "désactivé"');
    expect(platform).not.toContain('role="switch"');
    expect(platform).toContain("openSchoolAiAssistantConfirmation(drawerSchool");
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
    expect(rules).toContain("request.resource.data.aiAssistant.updatedBy == request.auth.uid");
  });

  it("confirme et audite la remise à zéro sans modifier limite ni activation", () => {
    expect(platform).toContain('aria-label="Réinitialiser le quota mensuel"');
    expect(platform).toContain('title="Réinitialiser le quota mensuel"');
    expect(platform).toContain("setAiQuotaResetTarget(drawerSchool)");
    expect(platform).toContain("confirmSchoolAiQuotaReset");
    expect(service).toContain('"platformAiResetMonthlyUsage"');
    expect(service).toContain("monthlyLimit: current.monthlyLimit");
    expect(service).toContain("enabled: school.aiAssistant?.enabled === true");
    expect(service).not.toContain('transaction.update(schoolRef, { "aiAssistant.monthlyUsage": 0');
    expect(service).toContain("Ancienne consommation");
  });
});
