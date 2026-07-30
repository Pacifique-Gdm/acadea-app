import type { AiAction } from "./aiWritingTypes";

const feminineDocumentPrefixes = ["lettre", "demande", "réponse", "convocation", "notification", "mise en demeure", "note"];

export function documentNameWithArticle(documentTypeLabel: string) {
  const normalized = documentTypeLabel.trim().toLocaleLowerCase("fr-FR");
  const article = feminineDocumentPrefixes.some((prefix) => normalized.startsWith(prefix)) ? "la" : "le";
  return `${article} ${normalized}`;
}

export function buildAiDocumentActions(documentTypeLabel: string): Array<{ value: AiAction; label: string }> {
  const documentName = documentNameWithArticle(documentTypeLabel);
  return [
    { value: "reformulate", label: `Reformuler ${documentName}` },
    { value: "write_complete", label: `Rédiger ${documentName} complet` },
    { value: "correct", label: `Corriger ${documentName}` },
    { value: "improve", label: `Améliorer ${documentName}` },
    { value: "develop", label: `Développer ${documentName}` },
    { value: "formalize", label: `Adapter ${documentName} au style administratif officiel` },
    { value: "summarize", label: `Résumer ${documentName}` },
    { value: "clarify", label: `Clarifier ${documentName}` },
    { value: "professionalize", label: `Rendre ${documentName} plus professionnel` },
  ];
}
