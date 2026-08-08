import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAiDocumentActions } from "./aiDocumentActions";
import { AI_DOCUMENT_ACTIONS } from "./aiWritingTypes";

describe("assistant IA du Secrétaire", () => {
  const component = readFileSync(new URL("./SecretaryAiAssistant.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../services/secretaryAi.ts", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../../../functions/src/ai/writingAssistant.ts", import.meta.url), "utf8");

  it("ne remplace jamais le texte avant acceptation humaine", () => {
    expect(component).toContain("Texte original");
    expect(component).toContain("Proposition de l’IA");
    expect(component).toContain("Appliquer au formulaire");
    expect(component).toContain("Refuser");
    expect(component.indexOf("onAccept(key, value)")).toBeGreaterThan(component.indexOf("function accept"));
  });

  it("exige le consentement et conserve le texte en cas d'erreur", () => {
    expect(component).toContain("consentConfirmed: true");
    expect(service).toContain("Votre texte n'a pas été modifié");
    expect(component).not.toContain("setSections(");
  });

  it("bloque l'interface et explique la désactivation avant d'afficher toute action IA", () => {
    expect(component).toContain('currentAiAssistant?.enabled !== true');
    expect(component).toContain("L’Assistant IA n’est pas activé pour votre établissement. Veuillez contacter votre administrateur.");
    expect(component.indexOf("if (currentAiAssistant?.enabled !== true) return")).toBeLessThan(component.indexOf('disabled={usageLoading || limitReached}'));
  });

  it("affiche le quota et n'appelle aucun service lorsque la limite est atteinte", () => {
    expect(component).toContain("{monthlyUsage} / {monthlyLimit} utilisations");
    expect(component).toContain("Il vous reste :");
    expect(component).toContain("Le quota mensuel de votre établissement est atteint");
    expect(component).toContain("if (limitReached) return");
    expect(component).toContain("withAiGenerationLock(lock, setBusy");
    expect(component.indexOf("if (limitReached) return")).toBeLessThan(component.indexOf("requestSecretaryAi(user"));
  });

  it("aligne la notice et le bouton de génération sur toute la largeur du Drawer", () => {
    expect(component).toContain('className="grid w-full gap-2"');
    expect(component).toContain('className="w-full rounded border border-violet-200');
    expect(component).toContain('className="secondary-button w-full justify-center"');
    expect(component).not.toContain("max-w-xl");
  });

  it("ne propose que Reformuler et Résumer et injecte le résultat modifiable", () => {
    const reportActions = buildAiDocumentActions("Rapport disciplinaire");
    expect(reportActions).toHaveLength(2);
    expect(reportActions.map((item) => item.value)).toEqual(["reformulate", "summarize"]);
    expect(reportActions.map((item) => item.label)).toEqual(["Reformuler le rapport disciplinaire", "Résumer le rapport disciplinaire"]);
    expect(buildAiDocumentActions("Lettre administrative")[0].label).toBe("Reformuler la lettre administrative");
    expect(reportActions.map((item) => item.value)).toEqual(AI_DOCUMENT_ACTIONS);
    expect(reportActions.every((item) => !item.label.includes(item.value))).toBe(true);
    expect(component).toContain("setEditableProposal(response.proposedText");
    expect(component).toContain('documentCategory, documentTypeLabel');
    expect(component).toContain("editedReportSectionsToApply(generatedParameters?.scope ?? result.scope, sections, editableSections)");
    expect(component).toContain("Proposition modifiable");
    expect(component).toContain("setEditableSections((previous)");
    expect(component).toContain("Le contenu généré par l’Assistant IA remplacera les sections correspondantes du document");
    expect(component).toContain("Une nouvelle génération remplacera le contenu actuellement affiché");
  });

  it("affiche le message callable exploitable", () => {
    expect(service).toContain("callableMessage");
    expect(service).toContain("return exploitableMessage");
  });

  it("journalise en staging uniquement les métadonnées non sensibles de la callable", () => {
    expect(service).toContain('import.meta.env.VITE_APP_ENV === "staging"');
    for (const field of ["action", "documentCategory", "documentType", "firebaseProjectId", "functionName", "region"]) expect(service).toContain(field);
    expect(service).not.toContain("originalText:");
  });

  it("n'expose aucune clé fournisseur dans le frontend", () => {
    expect(service).not.toContain("OPENAI_API_KEY");
    expect(service).not.toContain("api.openai.com");
    expect(backend).toContain('defineSecret("OPENAI_API_KEY")');
    expect(backend).toContain("request.auth");
    expect(backend).toContain("assertSecretaryAiIdentity(request.auth, input.schoolId");
    expect(backend).toContain("store: false");
    expect(backend).toContain('invoker: "public"');
    expect(backend).toContain("extractOpenAiResponseText");
  });

  it("protège références, signatures et données sensibles dans l'instruction serveur", () => {
    expect(backend).toContain("N'invente jamais");
    expect(backend).toContain("Ne génère jamais l'en-tête, la référence automatique, le statut, le signataire");
    expect(backend).toContain("sanitizeAiText");
    expect(backend).toContain("whitelistDocumentContext");
    for (const instruction of ["Réécris entièrement", "Réduis réellement le document"]) expect(backend).toContain(instruction);
  });

  it("transmet le contexte documentaire normalisé sans valeur undefined", () => {
    for (const field of ["documentDate", "documentTime", "sections", "documentContext", "schoolName", "academicYearName"]) expect(component).toContain(field);
    expect(component).toContain("Object.fromEntries");
    expect(component).toContain("typeof entry[1] === \"string\"");
    expect(backend).toContain("Utilise les date et heure fournies");
    expect(backend).toContain("Ne déclare pas qu'elles sont manquantes lorsqu'elles existent");
  });

  it("isole exactement les sections sélectionnées pour les rapports et les courriers", () => {
    expect(component).toContain("const effectiveScope: AiScope = scopeSelection");
    expect(component).toContain("if (result.sections)");
    expect(component).toContain("context: sectionsSent");
    expect(component).not.toContain("context: sections, tone");
    expect(component).not.toContain("targetSection:");
  });

  it("utilise les portées canoniques et une application atomique", () => {
    expect(component).toContain('aria-label="Document complet"');
    expect(component).toContain('mode: "selected_sections"');
    expect(component).toContain("selectedAiScopeKeys");
    expect(component).not.toContain('<option value="single_section">Section unique</option>');
    expect(component).not.toContain('effectiveScope === "single_section"');
    expect(component).toContain("scope: effectiveScope");
    expect(component).toContain("if (onApplySections) onApplySections(valuesToApply)");
    expect(component).toContain("sectionKeysSent: Object.keys(sectionsSent)");
    expect(component).toContain("resolveGeneratedScope(generatedParameters?.scope, result?.scope, effectiveScope)");
    expect(component).toContain("displayedScopeKeys.map");
  });

  it("ajoute une cle d'idempotence sans transmettre de compteur client", () => {
    expect(service).toContain("idempotencyKey: crypto.randomUUID()");
    expect(service).not.toContain("monthlyUsage:");
    expect(service).not.toContain("monthlyLimit:");
  });
});
