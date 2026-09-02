export type Role = "super_admin" | "coordination_admin" | "sub_coordination_admin" | "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary" | "teacher" | "parent";

export type SchoolClass =
  | "Maternelle 1"
  | "Maternelle 2"
  | "Maternelle 3"
  | "1ère Primaire"
  | "2ème Primaire"
  | "3ème Primaire"
  | "4ème Primaire"
  | "5ème Primaire"
  | "6ème Primaire"
  | "7ème CTEB"
  | "8ème CTEB"
  | "1ère Humanité"
  | "2ème Humanité"
  | "3ème Humanité"
  | "4ème Humanité";

export type FeeKind = "Minerval" | "Fourniture" | string;
export type StudentStatus = "ACTIVE" | "TRANSFERRED" | "DROPPED" | "DECEASED";
export type StudentExitReason = "Abandon" | "Mutation" | "Exclusion" | "Décès" | "Fin de scolarité" | "Erreur administrative" | "Autre";
export type SchoolSection = "Maternelle" | "Primaire" | "CTEB" | "Secondaire";
export type HumanityOption = "Littéraire" | "Sciences" | "Pédagogique" | "Commerciale" | string;

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  coordinationId?: string;
  subCoordinationId?: string;
  schoolId?: string;
  /** Périmètre métier facultatif pour compatibilité avec les comptes historiques. */
  section?: SchoolSection;
  /** Périmètre multi-sections. `section` reste lu pour les comptes historiques. */
  sectionIds?: SchoolSection[];
  activeSchoolYearId?: string;
  parentId?: string;
  studentIds?: string[];
  status?: "active" | "inactive";
  active?: boolean;
  phone?: string;
  address?: string;
  createdAt?: string;
  lastLoginAt?: string;
  removedAt?: string;
  removedBy?: string;
  archivedAt?: string;
  archivedBy?: string;
  reactivatedAt?: string;
  reactivatedBy?: string;
}

export interface School {
  id: string;
  schoolId?: string;
  name: string;
  motto?: string;
  address: string;
  phone: string;
  email: string;
  currency?: "USD" | "CDF";
  logoUrl?: string;
  acronym?: string;
  educationLevels?: string[];
  schoolOptions?: string[];
  schoolType?: "Maternelle" | "Primaire" | "CTEB" | "Secondaire" | "Primaire uniquement" | "CTEB uniquement" | "Secondaire uniquement" | "Mixte";
  createdAt?: string;
  createdBy?: string;
  mainAdminId?: string;
  updatedAt?: string;
  updatedBy?: string;
  activeSchoolYearId: string;
  activeCoordinationId?: string | null;
  status: "active" | "suspended" | "inactive" | "deleting";
  deletion?: {
    status: "running" | "failed";
    startedAt: string;
    startedBy: string;
    failedAt?: string;
    failedStep?: string;
  };
  subscriptionPlan: "Starter" | "Standard" | "Premium";
  subscriptionStatus?: "active" | "suspended" | "expired";
  subscriptionAmount: number;
  aiAssistant?: {
    enabled: boolean;
    monthlyLimit?: number;
    monthlyUsage?: number;
    usageMonth?: string;
    updatedAt?: string | { seconds: number; nanoseconds: number };
    updatedBy?: string;
  };
}

export interface SchoolYear {
  id: string;
  schoolId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "archived" | "draft";
  /** Devise monétaire propre à l'année. Absente uniquement sur les données historiques. */
  currency?: "USD" | "CDF";
  studentsImportedFromArchivedYear?: boolean;
  studentsImportedFromYearId?: string;
  studentsImportedAt?: string;
  customFeeKindChoices?: FeeKind[];
}

export interface Student {
  id: string;
  schoolId: string;
  schoolYearId: string;
  annee_scolaire_id?: string;
  matricule: string;
  nom: string;
  postnom: string;
  prenom: string;
  sexe: "M" | "F";
  birthDate: string;
  address: string;
  phone: string;
  className: SchoolClass;
  /** Structured class references. Optional for backward compatibility. */
  classId?: string;
  subClassId?: string;
  /** Stable option identity used to scope secondary subclasses. */
  classOptionKey?: string;
  section?: SchoolSection;
  option?: HumanityOption;
  status?: StudentStatus;
  exitReason?: StudentExitReason;
  exitReasonDetails?: string;
  deletedAt?: string;
  photoUrl?: string;
  parentId?: string;
  biometric?: StudentBiometric;
  importedFromStudentId?: string;
  importedFromSchoolYearId?: string;
}

export type FingerprintStatus = "not_enrolled" | "enrolled" | "disabled";
export type CardStatus = "not_assigned" | "assigned" | "disabled";

export interface StudentBiometric {
  fingerprintStatus: FingerprintStatus;
  fingerprintUpdatedAt: string | null;
  cardStatus: CardStatus;
  cardUid: string | null;
  cardUpdatedAt: string | null;
}

export interface ParentProfile {
  id: string;
  schoolId: string;
  schoolYearId: string;
  userId: string;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  studentIds: string[];
  status: "active" | "inactive";
}

export interface FeeType {
  id: string;
  schoolId: string;
  schoolYearId: string;
  name: FeeKind;
  amount: number;
  className?: SchoolClass;
  classOptionKey?: string;
}

export interface Payment {
  id: string;
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  parentId?: string;
  feeTypeId: string;
  amount: number;
  paidAt: string;
  createdAt?: string;
  receiptNumber?: string;
  cashierName: string;
  note?: string;
  updatedAt?: string;
  correctionReason?: string;
  createdBy?: string;
  updatedBy?: string;
  provenance?: "financial-api";
  clientRequestIdHash?: string;
}

export interface SchoolClassRecord {
  id: string;
  schoolId: string;
  schoolYearId: string;
  name: string;
  section?: SchoolSection;
  option?: string;
  vacation?: "morning" | "afternoon";
  saturdayVacation?: "morning" | "afternoon" | null;
  saturdayEnabled?: boolean;
  active?: boolean;
  parentClassId?: string;
  /** Operational parent option for a secondary subclass. */
  classOptionKey?: string;
  subClassLabel?: string;
}

export interface CoordinationYearGovernance {
  operationId: string;
  status: "closed" | "reactivated" | "superseded";
  years: Array<{ schoolId: string; schoolYearId: string }>;
  closedAt: string;
  closedBy: string;
  reactivatedAt?: string;
  reactivatedBy?: string;
  supersededAt?: string;
  supersededBy?: string;
}

export interface Coordination {
  id: string;
  name: string;
  code?: string;
  status: "active" | "inactive" | "archived";
  logoUrl?: string;
  phone?: string;
  email?: string;
  address?: string;
  principalCoordinatorUserId?: string;
  referenceSchoolYear?: string;
  yearGovernance?: CoordinationYearGovernance;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  archivedAt?: string;
  archivedBy?: string;
}

export interface CoordinationSchool {
  id: string;
  coordinationId: string;
  schoolId: string;
  active: boolean;
  addedAt: string;
  addedBy: string;
  removedAt?: string;
  removedBy?: string;
}

export interface SubCoordination {
  id: string;
  coordinationId: string;
  coordinatorUserId: string;
  circumscription: string;
  status: "active" | "archived";
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt?: string | null;
  archivedBy?: string | null;
  reactivatedAt?: string | null;
  reactivatedBy?: string | null;
}

export interface SubCoordinationSchool {
  id: string;
  coordinationId: string;
  subCoordinationId: string;
  schoolId: string;
  active: boolean;
  addedAt: string;
  addedBy: string;
  removedAt?: string | null;
  removedBy?: string | null;
}

export interface PersonnelProfile {
  id: string;
  schoolId: string;
  personnelId: string;
  matricule: string;
  photoUrl?: string;
  photoPath?: string;
  lastName?: string;
  middleName?: string;
  firstName?: string;
  jobTitle?: string;
  gender?: "F" | "M" | "Autre";
  birthDate?: string;
  birthPlace?: string;
  address?: string;
  engagementDate?: string;
  contractType?: string;
  educationLevel?: string;
  diploma?: string;
  specialty?: string;
  trainingInstitution?: string;
  graduationYear?: number;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  observations?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Expense {
  id: string;
  schoolId: string;
  schoolYearId: string;
  amount: number;
  category: string;
  description: string;
  beneficiary?: string;
  paymentMethod?: string;
  reference?: string;
  spentAt: string;
  createdAt: string;
  cashierName: string;
  updatedAt?: string;
  correctionReason?: string;
  createdBy?: string;
  updatedBy?: string;
  provenance?: "financial-api";
  clientRequestIdHash?: string;
}

export interface Message {
  id: string;
  schoolId: string;
  schoolYearId: string;
  senderId: string;
  senderName?: string;
  senderRole?: "parent" | "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary" | "teacher" | "coordination_admin" | "sub_coordination_admin";
  participantIds?: string[];
  recipientIds?: string[];
  recipientParentId: string | "all" | "school";
  schoolRecipient?: "admin" | "cashier" | "discipline" | "both";
  threadParentId?: string;
  threadId?: string;
  conversationId?: string;
  disciplineSanctionId?: string;
  subject: string;
  body: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface MessageAttachment {
  name: string;
  type: string;
  size: number;
  path: string;
  url: string;
}

export interface Conversation {
  id: string;
  schoolId: string;
  schoolYearId: string;
  threadId: string;
  participantIds?: string[];
  threadParentId: string;
  parentId: string;
  parentName?: string;
  schoolRecipient?: "admin" | "cashier" | "discipline" | "both";
  lastMessage: string;
  lastMessageAt: string;
  lastSenderId: string;
  lastSenderRole: "parent" | "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary" | "teacher";
  messageCount: number;
  unreadParentCount: number;
  unreadAdminCount: number;
  unreadCashierCount: number;
  unreadDisciplineCount?: number;
  createdAt: string;
  updatedAt: string;
  status: "active";
}

export interface AppNotification {
  id: string;
  schoolId: string;
  schoolYearId: string;
  recipientRole?: "parent" | "school";
  recipientUserId?: string;
  parentId?: string;
  studentId?: string;
  studentName?: string;
  messageId?: string;
  disciplineSanctionId?: string;
  attendanceId?: string;
  announcementId?: string;
  audienceRoles?: Array<"parent" | "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary">;
  audienceParentIds?: string[];
  audienceSchoolWide?: boolean;
  schoolRecipient?: "admin" | "cashier" | "discipline" | "both";
  type: "payment" | "message" | "valve" | "attendance" | "availability";
  module?: "payments" | "attendance" | "discipline" | "announcements";
  event?: "payment_recorded" | "student_absent" | "student_late" | "discipline_incident_created" | "announcement_published";
  destination?: "/dashboard";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface AuditLog {
  id: string;
  eventType?: string;
  coordinationId?: string;
  subCoordinationId?: string;
  schoolId?: string;
  schoolYearId?: string;
  actorId: string;
  actorRole?: AppUser["role"];
  actorName: string;
  resourceType?: string;
  resourceId?: string;
  source?: "server";
  metadata?: Record<string, string | number | boolean>;
  action: string;
  details?: string;
  createdAt: string;
}

export interface DisciplineSanction {
  id: string;
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  studentName: string;
  classId?: string;
  className: string;
  reason: string;
  description: string;
  sanctionType: string;
  duration: number;
  startDate: string;
  expectedEndDate: string;
  actualEndDate?: string;
  observation?: string;
  status: "active" | "completed";
  recurrenceNumber: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  completedBy?: string;
  completedByName?: string;
  completedAt?: string;
}

export type ValvePublicationKind = "communique" | "palmares" | "points" | "image" | "liste" | "pdf" | "document" | "autre";
export type ValveVisibility = "all_parents" | SchoolSection | "class";

export interface ValvePublicationAttachment {
  name: string;
  type: string;
  url: string;
  path: string;
  size: number;
}

export interface ValvePublication {
  id: string;
  schoolId: string;
  schoolYearId: string;
  title: string;
  kind: ValvePublicationKind;
  visibility: ValveVisibility;
  targetClassKey?: string;
  body: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentDataUrl?: string;
  attachmentUrl?: string;
  attachmentPath?: string;
  attachmentSize?: number;
  attachments?: ValvePublicationAttachment[];
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
}

export type AttendanceSource = "biometric" | "manual";
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type AttendanceSchoolDay = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

export interface AttendanceDaySchedule {
  normalArrival?: string;
  lateAfter?: string;
}

export interface AttendanceRecord {
  id: string;
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  attendanceDate: string;
  status: AttendanceStatus;
  recordedAt: string;
  recordedBy: string;
  source: AttendanceSource;
  manualReason?: string;
}

export interface AttendanceSettings {
  id: string;
  schoolId: string;
  schoolYearId: string;
  schoolDays?: AttendanceSchoolDay[];
  defaultSchedule?: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>;
  sectionSchedule?: Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>;
  classSchedule?: Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>;
  defaultLateAfter?: string;
  sectionLateAfter?: Partial<Record<SchoolSection, string>>;
  classLateAfter?: Record<string, string>;
  updatedAt?: string;
  updatedBy?: string;
}

export type BiometricTerminalStatus = "unconfigured" | "connected" | "offline" | "disabled";

export interface BiometricTerminal {
  id: string;
  terminalId: string;
  schoolId: string;
  serialNumber: string;
  deviceId?: string;
  brand: string;
  model: string;
  name: string;
  location: string;
  status: BiometricTerminalStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  lastSyncAt?: string;
  replacedByTerminalId?: string;
}

export interface AppData {
  users: AppUser[];
  schools: School[];
  schoolYears: SchoolYear[];
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  messages: Message[];
  notifications: AppNotification[];
  auditLogs: AuditLog[];
  valves: ValvePublication[];
  disciplineSanctions: DisciplineSanction[];
  attendance: AttendanceRecord[];
  attendanceSettings: AttendanceSettings[];
  biometricTerminals: BiometricTerminal[];
}

export { CLASSES } from "./utils/studentYearTransition.js";

export const FEE_KINDS: FeeKind[] = ["Minerval", "Fourniture"];
