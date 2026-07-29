import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("assistant IA du Secrétaire", () => {
  const component = readFileSync(new URL("./SecretaryAiAssistant.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../services/secretaryAi.ts", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../../../functions/src/ai/writingAssistant.ts", import.meta.url), "utf8");

  it("ne remplace jamais le texte avant acceptation humaine", () => {
    expect(component).toContain("Texte original");
    expect(component).toContain("Proposition de l’IA");
    expect(component).toContain("Accepter tout");
    expect(component).toContain("Refuser");
    expect(component.indexOf("onAccept(section")).toBeGreaterThan(component.indexOf("function accept"));
  });

  it("exige le consentement et conserve le texte en cas d'erreur", () => {
    expect(component).toContain("consentConfirmed: true");
    expect(service).toContain("Votre texte n'a pas été modifié");
    expect(component).not.toContain("setSections(");
  });

  it("bloque l'interface et explique la désactivation avant d'afficher toute action IA", () => {
    expect(component).toContain("enabled: boolean");
    expect(component).toContain("L’Assistant IA n’est pas activé pour votre établissement. Veuillez contacter votre administrateur.");
    expect(component.indexOf("if (!enabled) return")).toBeLessThan(component.indexOf('return <><button type="button"'));
  });

  it("propose les trois parcours rédactionnels attendus et injecte le résultat", () => {
    expect(component).toContain("Rédiger une réponse");
    expect(component).toContain("Améliorer un texte");
    expect(component).toContain(">Reformuler<");
    expect(component).toContain("setEditableProposal(response.proposedText");
  });

  it("affiche le message callable exploitable", () => {
    expect(service).toContain("callableMessage");
    expect(service).toContain("return exploitableMessage");
  });

  it("n'expose aucune clé fournisseur dans le frontend", () => {
    expect(service).not.toContain("OPENAI_API_KEY");
    expect(service).not.toContain("api.openai.com");
    expect(backend).toContain('defineSecret("OPENAI_API_KEY")');
    expect(backend).toContain("request.auth");
    expect(backend).toContain("assertSecretaryAiEnabled(request.auth, input.schoolId");
    expect(backend).toContain("store: false");
    expect(backend).toContain('invoker: "public"');
    expect(backend).toContain("extractOpenAiResponseText");
  });

  it("protège références, signatures et données sensibles dans l'instruction serveur", () => {
    expect(backend).toContain("N'invente jamais");
    expect(backend).toContain("Ne génère jamais l'en-tête, la référence automatique, le statut, le signataire");
    expect(backend).toContain("sanitizeAiText");
    expect(backend).toContain("sanitizeAiContext");
  });
});
