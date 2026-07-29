export interface OpenAiFailure {
  status: number;
  code?: string;
  type?: string;
}

export const OPENAI_WRITING_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "acadea_writing_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      proposedText: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { key: { type: "string" }, value: { type: "string" } },
          required: ["key", "value"],
        },
      },
      warnings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            severity: { type: "string", enum: ["info", "warning", "critical"] },
            title: { type: "string" },
            message: { type: "string" },
            field: { type: "string" },
          },
          required: ["code", "severity", "title", "message", "field"],
        },
      },
      missingInformation: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { field: { type: "string" }, message: { type: "string" } },
          required: ["field", "message"],
        },
      },
    },
    required: ["proposedText", "sections", "warnings", "missingInformation"],
  },
} as const;

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

export function normalizeOpenAiSections(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.flatMap((item) => item && typeof item === "object" && typeof (item as { key?: unknown }).key === "string" && typeof (item as { value?: unknown }).value === "string"
    ? [[(item as { key: string }).key, (item as { value: string }).value] as const]
    : []));
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
