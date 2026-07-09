export type Role = "super_admin" | "school_admin" | "cashier" | "parent";

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
export type SchoolSection = "maternelle" | "primaire" | "secondaire";
export type HumanityOption = "Littéraire" | "Sciences" | "Pédagogique" | "Commerciale" | string;

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  schoolId?: string;
  activeSchoolYearId?: string;
  parentId?: string;
  studentIds?: string[];
  status?: "active" | "inactive";
  phone?: string;
  address?: string;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface School {
  id: string;
  schoolId?: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  currency: "USD";
  logoUrl?: string;
  acronym?: string;
  educationLevels?: string[];
  schoolOptions?: string[];
  schoolType?: "Maternelle" | "Primaire" | "Secondaire" | "Mixte";
  createdAt?: string;
  createdBy?: string;
  mainAdminId?: string;
  updatedAt?: string;
  updatedBy?: string;
  activeSchoolYearId: string;
  status: "active" | "suspended";
  subscriptionPlan: "Starter" | "Standard" | "Premium";
  subscriptionStatus?: "active" | "suspended" | "expired";
  subscriptionAmount: number;
}

export interface SchoolYear {
  id: string;
  schoolId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "archived" | "draft";
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
  section?: SchoolSection;
  option?: HumanityOption;
  status?: StudentStatus;
  exitReason?: StudentExitReason;
  exitReasonDetails?: string;
  deletedAt?: string;
  photoUrl?: string;
  parentId?: string;
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
}

export interface Message {
  id: string;
  schoolId: string;
  schoolYearId: string;
  senderId: string;
  recipientParentId: string | "all" | "school";
  schoolRecipient?: "admin" | "cashier" | "both";
  threadParentId?: string;
  threadId?: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  schoolId: string;
  schoolYearId: string;
  recipientRole?: "parent" | "school";
  parentId?: string;
  studentId?: string;
  messageId?: string;
  schoolRecipient?: "admin" | "cashier" | "both";
  type: "payment" | "message" | "valve";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface AuditLog {
  id: string;
  schoolId?: string;
  schoolYearId?: string;
  actorId: string;
  actorName: string;
  action: string;
  details?: string;
  createdAt: string;
}

export type ValvePublicationKind = "communique" | "palmares" | "points" | "image" | "liste" | "pdf" | "document" | "autre";
export type ValveVisibility = "all_parents" | "maternelle" | "primaire" | "secondaire" | "class";

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
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
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
}

export const CLASSES: SchoolClass[] = [
  "Maternelle 1",
  "Maternelle 2",
  "Maternelle 3",
  "1ère Primaire",
  "2ème Primaire",
  "3ème Primaire",
  "4ème Primaire",
  "5ème Primaire",
  "6ème Primaire",
  "7ème CTEB",
  "8ème CTEB",
  "1ère Humanité",
  "2ème Humanité",
  "3ème Humanité",
  "4ème Humanité",
];

export const FEE_KINDS: FeeKind[] = ["Minerval", "Fourniture"];
