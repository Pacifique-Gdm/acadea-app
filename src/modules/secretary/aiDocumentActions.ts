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
    { value: "summarize", label: `Résumer ${documentName}` },
  ];
}
