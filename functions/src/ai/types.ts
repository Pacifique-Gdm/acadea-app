export const AI_ACTIONS = ["reformulate", "write_complete", "correct", "improve", "develop", "formalize", "summarize", "clarify", "professionalize"] as const;
export type AiAction = typeof AI_ACTIONS[number];
export const AI_TONES = ["neutral", "administrative", "formal", "professional", "concise", "diplomatic"] as const;
export type AiTone = typeof AI_TONES[number];
export const AI_LENGTHS = ["short", "standard", "developed"] as const;
export type AiLength = typeof AI_LENGTHS[number];
export type AiScope = "full_document" | string;

export interface AiWritingRequest {
  schoolId: string;
  academicYearId?: string;
  documentId?: string;
  documentType: string;
  documentCategory: "courrier" | "rapport";
  documentTypeLabel: string;
  documentDate?: string;
  documentTime?: string;
  scope: AiScope;
  sections: Record<string, string>;
  targetSection?: { key: string; value: string };
  documentContext: { date?: string; time?: string; endTime?: string; schoolName?: string; academicYearName?: string };
  section?: string;
  action: AiAction;
  originalText?: string;
  context?: Record<string, unknown>;
  tone: AiTone;
  length: AiLength;
  additionalInstruction: string;
  consentConfirmed: boolean;
}

export interface AiWarning { code: string; severity: "info" | "warning" | "critical"; title: string; message: string; field?: string }
export interface AiWritingResponse {
  success: boolean;
  action: AiAction;
  scope: AiScope;
  originalText?: string;
  proposedText?: string;
  section?: { key: string; value: string };
  sections?: Record<string, string>;
  warnings: AiWarning[];
  missingInformation: Array<{ field: string; message: string }>;
  metadata: { requestId: string; generatedAt: string; version: string };
}
