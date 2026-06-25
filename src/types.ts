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
  | "Humanités";

export type FeeKind = "Minerval" | "Bulletin" | "Examen" | "Autres";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  schoolId?: string;
  activeSchoolYearId?: string;
  demoPassword?: string;
  parentId?: string;
  studentIds?: string[];
}

export interface School {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  currency: "USD";
  logoUrl?: string;
  activeSchoolYearId: string;
  status: "active" | "suspended";
  subscriptionPlan: "Starter" | "Standard" | "Premium";
  subscriptionAmount: number;
}

export interface SchoolYear {
  id: string;
  schoolId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "archived" | "draft";
}

export interface Student {
  id: string;
  schoolId: string;
  schoolYearId: string;
  matricule: string;
  nom: string;
  postnom: string;
  prenom: string;
  sexe: "M" | "F";
  birthDate: string;
  address: string;
  phone: string;
  className: SchoolClass;
  photoUrl?: string;
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
}

export interface FeeType {
  id: string;
  schoolId: string;
  schoolYearId: string;
  name: FeeKind;
  amount: number;
}

export interface Payment {
  id: string;
  schoolId: string;
  schoolYearId: string;
  studentId: string;
  feeTypeId: string;
  amount: number;
  paidAt: string;
  cashierName: string;
  note?: string;
}

export interface Message {
  id: string;
  schoolId: string;
  schoolYearId: string;
  senderId: string;
  recipientParentId: string | "all";
  subject: string;
  body: string;
  createdAt: string;
}

export interface AppData {
  users: AppUser[];
  schools: School[];
  schoolYears: SchoolYear[];
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  messages: Message[];
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
  "Humanités",
];

export const FEE_KINDS: FeeKind[] = ["Minerval", "Bulletin", "Examen", "Autres"];
