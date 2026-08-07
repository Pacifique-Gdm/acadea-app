import type { PdfGenerationSettings } from "../../utils/pdfSettings";
import type { ReportSignatory } from "./reportSignatories";
export type { ReportSignatory } from "./reportSignatories";

export type CorrespondenceDirection = "incoming" | "outgoing";
export type CorrespondenceStatus = "draft" | "pending_validation" | "validated" | "signed" | "ready_to_send" | "sent" | "received" | "archived" | "cancelled";

export type OutgoingCorrespondenceType = "administrative_letter" | "official_request" | "administrative_response" | "transmission_letter" | "summons" | "notification" | "formal_notice" | "information_letter" | "other";
export type CorrespondencePriority = "normal" | "important" | "urgent" | "very_urgent";
export type CorrespondenceConfidentiality = "public" | "internal" | "confidential" | "strictly_confidential";
export type SignatureType = "stored" | "handwritten_space" | "none";

export interface CorrespondenceRecipient {
  salutation: "mr" | "mrs" | "ladies_gentlemen" | "other";
  customSalutation?: string;
  functionTitle?: string;
  fullName?: string;
  institution?: string;
  address?: string;
  city?: string;
  country?: string;
}

export interface CorrespondenceSigner {
  userId: string;
  fullName: string;
  functionTitle: string;
  signatureType: SignatureType;
  signatureRequired: boolean;
  stampRequired: boolean;
  signatureSpace: "small" | "medium" | "large";
}

export interface CorrespondenceVisa {
  required: boolean;
  personName?: string;
  functionTitle?: string;
  mention?: string;
  signatureType?: SignatureType;
  date?: string;
  stampRequired?: boolean;
}

export interface AnnouncedCorrespondenceAttachment {
  id: string;
  title: string;
  copies: number;
  includeInPdf: boolean;
}

export interface CorrespondenceCopy {
  id: string;
  nameOrFunction: string;
  institution?: string;
  reason?: string;
  includeInPdf: boolean;
}

export interface OutgoingCorrespondenceData {
  correspondenceType: OutgoingCorrespondenceType;
  customCorrespondenceType?: string;
  issuePlace: string;
  academicYearName: string;
  authorName: string;
  priority: CorrespondencePriority;
  confidentiality: CorrespondenceConfidentiality;
  deliveryMode: string;
  customDeliveryMode?: string;
  specialMention?: string;
  customSpecialMention?: string;
  underCoverOf?: string;
  recipient: CorrespondenceRecipient;
  previousReference?: string;
  salutation: string;
  introduction: string;
  mainMessage: string;
  details?: string;
  justification?: string;
  expectedFollowUp?: string;
  conclusion: string;
  closingFormula: string;
  signer: CorrespondenceSigner;
  /** Source canonique. `signer` reste présent pour lire les anciens courriers. */
  signatories?: ReportSignatory[];
  visa?: CorrespondenceVisa;
  announcedAttachments: AnnouncedCorrespondenceAttachment[];
  copies: CorrespondenceCopy[];
  /** Champs historiques conservés uniquement pour lire les courriers déjà enregistrés. */
  sendingChannel?: string;
  customSendingChannel?: string;
  plannedSendDate?: string;
  recipientEmail?: string;
  receiptRequired?: boolean;
  sentBy?: string;
  actualSendDate?: string;
  confirmedReceptionDate?: string;
  issuingDepartment?: string;
  category?: string;
  filingFolder?: string;
  keywords?: string[];
  internalNotes?: string;
  version: number;
  orderNumber?: string;
  validatedBy?: string;
  validatedAt?: string;
  signedBy?: string;
  signedAt?: string;
  archivedBy?: string;
  archivedAt?: string;
  pdfUrl?: string;
  pdfGeneratedAt?: string;
}

export interface CorrespondenceAttachment {
  name: string;
  type: string;
  size: number;
  url: string;
  path: string;
}

export interface Correspondence {
  id: string;
  referenceNumber: string;
  direction: CorrespondenceDirection;
  date: string;
  subject: string;
  sender: string;
  recipient: string;
  content: string;
  copiePourInformation?: string;
  status: CorrespondenceStatus;
  attachment?: CorrespondenceAttachment;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  schoolId: string;
  schoolYearId: string;
  outgoing?: OutgoingCorrespondenceData;
  pdfSettings?: PdfGenerationSettings;
  archivedFromStatus?: CorrespondenceStatus | null;
}

export interface StudentMedicalRecord {
  id: string;
  studentId: string;
  schoolId: string;
  schoolYearId: string;
  bloodGroup: string;
  rhesus?: string;
  height?: string;
  weight?: string;
  medicalHistory?: string;
  allergies: string;
  chronicDiseases: string;
  currentTreatments: string;
  disabilityOrSpecialNeed: string;
  vaccinations: string;
  medicalObservations: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  attendingPhysician: string;
  physicianPhone: string;
  referenceHealthCenter: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type StudentMedicalRecordStatus = "complete" | "incomplete" | "missing";

export type SecretaryReportType = "meeting_minutes" | "activity_report" | "incident_report" | "official_minutes" | "administrative_note" | "other";
export type SecretaryReportStatus = "draft" | "finalized" | "archived";

export interface SecretaryReport {
  id: string;
  reportNumber: string;
  type: SecretaryReportType;
  title: string;
  documentDate: string;
  startTime: string;
  endTime: string;
  structuredContent: Record<string, string>;
  signatories?: ReportSignatory[];
  pdfSettings?: PdfGenerationSettings;
  status: SecretaryReportStatus;
  authorId: string;
  authorName: string;
  schoolId: string;
  schoolYearId: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  archivedAt?: string;
  archivedFromStatus?: SecretaryReportStatus | null;
  archivedBy?: string;
  restoredAt?: string;
  restoredBy?: string;
}
