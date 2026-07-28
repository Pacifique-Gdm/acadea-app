export const AI_ACTIONS = ["correct", "reformulate", "formalize", "simplify", "shorten", "expand", "summarize", "generate_draft", "generate_section", "verify_document", "transform_notes"] as const;
export type AiAction = typeof AI_ACTIONS[number];
export type AiTone = "administrative" | "professional" | "formal" | "courteous" | "diplomatic" | "firm" | "neutral";
export type AiLength = "short" | "similar" | "detailed";

export interface AiWritingRequest {
  schoolId: string;
  academicYearId?: string;
  documentId?: string;
  documentType: string;
  section?: string;
  action: AiAction;
  originalText?: string;
  context?: Record<string, unknown>;
  tone?: AiTone;
  length?: AiLength;
  additionalInstruction?: string;
  consentConfirmed: boolean;
}

export interface AiWarning { code: string; severity: "info" | "warning" | "critical"; title: string; message: string; field?: string }
export interface AiWritingResponse {
  success: boolean;
  action: AiAction;
  originalText?: string;
  proposedText?: string;
  sections?: Record<string, string>;
  warnings: AiWarning[];
  missingInformation: Array<{ field: string; message: string }>;
  metadata: { requestId: string; generatedAt: string };
}
