export type CorrespondenceDirection = "incoming" | "outgoing";
export type CorrespondenceStatus = "draft" | "sent" | "received" | "archived";

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
  status: CorrespondenceStatus;
  attachment?: CorrespondenceAttachment;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  schoolId: string;
  schoolYearId: string;
}

export type SecretaryReportType = "meeting_minutes" | "activity_report" | "incident_report" | "official_minutes" | "administrative_note" | "other";
export type SecretaryReportStatus = "draft" | "finalized" | "archived";

export interface SecretaryReport {
  id: string;
  reportNumber: string;
  type: SecretaryReportType;
  title: string;
  documentDate: string;
  structuredContent: Record<string, string>;
  status: SecretaryReportStatus;
  authorId: string;
  authorName: string;
  schoolId: string;
  schoolYearId: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  archivedAt?: string;
}
