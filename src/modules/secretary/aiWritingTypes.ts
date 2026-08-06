export const AI_DOCUMENT_ACTIONS = ["reformulate", "summarize"] as const;
export type AiAction = typeof AI_DOCUMENT_ACTIONS[number];
export const AI_TONES = ["administrative", "professional", "neutral", "formal"] as const;
export type AiTone = typeof AI_TONES[number];
export const AI_LENGTHS = ["short", "standard", "developed"] as const;
export type AiLength = typeof AI_LENGTHS[number];
export type AiScopeSelection = { mode: "full_document" } | { mode: "selected_sections"; sections: string[] };
export type AiScope = "full_document" | string | AiScopeSelection;
export interface AiDocumentContext { date?: string; time?: string; endTime?: string; schoolName?: string; academicYearName?: string }
export interface AiWritingRequest { schoolId: string; academicYearId?: string; documentId?: string; documentType: string; documentCategory: "courrier" | "rapport"; documentTypeLabel: string; documentDate?: string; documentTime?: string; scope: AiScope; sections: Record<string, string>; targetSection?: { key: string; value: string }; documentContext: AiDocumentContext; action: AiAction; originalText?: string; context?: Record<string, unknown>; tone: AiTone; length: AiLength; additionalInstruction: string; consentConfirmed: boolean }
export interface AiWritingResponse { success: boolean; action: AiAction; scope: AiScope; originalText?: string; proposedText?: string; section?: { key: string; value: string }; sections?: Record<string, string>; warnings: Array<{ code: string; severity: "info" | "warning" | "critical"; title: string; message: string; field?: string }>; missingInformation: Array<{ field: string; message: string }>; metadata: { requestId: string; generatedAt: string; version: string; backendVersion: string } }
export interface SchoolAiSettings { schoolId: string; enabled: boolean; allowedRoles: string[]; allowedActions: AiAction[]; allowedDocumentTypes: string[]; dailyRequestLimit?: number; maxInputCharacters?: number; retainDetailedHistory: boolean; requireUserConsent: boolean; updatedAt: unknown; updatedBy: string }
export const SECRETARY_AI_PERMISSIONS = ["secretary.ai.use", "secretary.ai.correct", "secretary.ai.generate", "secretary.ai.verify", "secretary.ai.view_history"] as const;
