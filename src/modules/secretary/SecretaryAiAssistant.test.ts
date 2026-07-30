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
    expect(component.indexOf("onAccept(section")).toBeGreaterThan(component.indexOf("function accept"));
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

  it("construit neuf actions avec le type précis et injecte le résultat modifiable", () => {
    const reportActions = buildAiDocumentActions("Rapport disciplinaire");
    expect(reportActions).toHaveLength(9);
    expect(reportActions.map((item) => item.value)).toEqual(["reformulate", "write_complete", "correct", "improve", "develop", "formalize", "summarize", "clarify", "professionalize"]);
    expect(reportActions.map((item) => item.label)).toEqual([
      "Reformuler le rapport disciplinaire", "Rédiger le rapport disciplinaire complet", "Corriger le rapport disciplinaire", "Améliorer le rapport disciplinaire", "Développer le rapport disciplinaire", "Adapter le rapport disciplinaire au style administratif officiel", "Résumer le rapport disciplinaire", "Clarifier le rapport disciplinaire", "Rendre le rapport disciplinaire plus professionnel",
    ]);
    expect(buildAiDocumentActions("Lettre administrative")[0].label).toBe("Reformuler la lettre administrative");
    expect(reportActions.map((item) => item.value)).toEqual(AI_DOCUMENT_ACTIONS);
    expect(reportActions.every((item) => !item.label.includes(item.value))).toBe(true);
    expect(component).toContain("setEditableProposal(response.proposedText");
    expect(component).toContain('documentCategory, documentTypeLabel');
    expect(component).toContain("parseEditableSections(editableProposal");
    expect(component).toContain("editedReportSectionsToApply(generatedParameters?.scope ?? result.scope, sections, editableSections)");
    expect(component).toContain("Proposition modifiable");
    expect(component).toContain("setEditableSections((previous)");
    expect(component).toContain("Le contenu généré par l’Assistant IA remplacera les sections correspondantes du rapport");
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
    expect(backend).toContain("sanitizeAiContext");
    for (const instruction of ["Produis un document complet", "Enrichis fortement", "Réécris le document pour améliorer nettement", "Réécris entièrement", "Corrige uniquement", "Adopte un ton formel", "Réduis le document", "Rends le texte plus précis", "Renforce la qualité rédactionnelle"]) expect(backend).toContain(instruction);
  });

  it("transmet le contexte documentaire normalisé sans valeur undefined", () => {
    for (const field of ["documentDate", "documentTime", "sections", "documentContext", "schoolName", "academicYearName"]) expect(component).toContain(field);
    expect(component).toContain("Object.fromEntries");
    expect(component).toContain("typeof entry[1] === \"string\"");
    expect(backend).toContain("Utilise les date et heure fournies");
    expect(backend).toContain("Ne déclare pas qu'elles sont manquantes lorsqu'elles existent");
  });

  it("isole les sections de rapport et conserve la concaténation globale des courriers", () => {
    expect(component).toContain('effectiveScope === "full_document"');
    expect(component).toContain('documentCategory === "rapport" && result.sections');
    expect(component).toContain("context: sectionsSent");
    expect(component).not.toContain("context: sections, tone");
  });

  it("utilise les portées canoniques et une application atomique", () => {
    expect(component).toContain('<option value="full_document">Document complet</option>');
    expect(component).not.toContain('<option value="single_section">Section unique</option>');
    expect(component).not.toContain('effectiveScope === "single_section"');
    expect(component).toContain('targetSection: { key: effectiveScope');
    expect(component).toContain("scope: effectiveScope");
    expect(component).toContain("if (onApplySections) onApplySections(valuesToApply)");
    expect(component).toContain("sectionKeysSent: Object.keys(sectionsSent)");
    expect(component).toContain("resolveGeneratedScope(generatedParameters?.scope, result?.scope, effectiveScope)");
    expect(component).toContain('displayedScope === "full_document" ? Object.keys(editableSections) : [displayedScope]');
  });
});
