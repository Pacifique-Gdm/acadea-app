export interface OpenAiFailure {
  status: number;
  code?: string;
  type?: string;
}

export type OpenAiCallableErrorCode = "failed-precondition" | "resource-exhausted" | "invalid-argument" | "unavailable";

export function classifyOpenAiFailure(status: number): { code: OpenAiCallableErrorCode; message: string } {
  if (status === 401 || status === 403) return { code: "failed-precondition", message: "La configuration OpenAI a été refusée par le fournisseur." };
  if (status === 429) return { code: "resource-exhausted", message: "La limite OpenAI est temporairement atteinte. Réessayez dans quelques instants." };
  if (status >= 400 && status < 500) return { code: "invalid-argument", message: "OpenAI a refusé les paramètres de génération." };
  return { code: "unavailable", message: `OpenAI est temporairement indisponible (HTTP ${status}).` };
}

export function extractOpenAiResponseText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const response = value as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  if (!Array.isArray(response.output)) return "";
  return response.output.flatMap((item) => {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) return [];
    return (item as { content: unknown[] }).content.flatMap((content) => {
      if (!content || typeof content !== "object") return [];
      const block = content as { type?: unknown; text?: unknown };
      return block.type === "output_text" && typeof block.text === "string" ? [block.text] : [];
    });
  }).join("\n").trim();
}

export function readOpenAiFailure(status: number, value: unknown): OpenAiFailure {
  const error = value && typeof value === "object" && "error" in value && value.error && typeof value.error === "object"
    ? value.error as { code?: unknown; type?: unknown }
    : undefined;
  return {
    status,
    code: typeof error?.code === "string" ? error.code : undefined,
    type: typeof error?.type === "string" ? error.type : undefined,
  };
}
