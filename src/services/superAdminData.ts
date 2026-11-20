import { collection, doc, getDoc, getDocs, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppData, AppUser, AuditLog, BiometricTerminal, Expense, FeeType, Message, ParentProfile, Payment, School, SchoolYear, Student, ValvePublication } from "../types";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../utils/schoolOptions";

export type SuperAdminSchoolData = {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  messages: Message[];
  notifications: AppData["notifications"];
  auditLogs: AuditLog[];
  valves: ValvePublication[];
  biometricTerminals: BiometricTerminal[];
  users: AppUser[];
  admins: AppUser[];
};

function emptySuperAdminData(): AppData {
  return {
    users: [],
    schools: [],
    schoolYears: [],
    students: [],
    parents: [],
    feeTypes: [],
    payments: [],
    expenses: [],
    messages: [],
    notifications: [],
    auditLogs: [],
    valves: [],
    disciplineSanctions: [],
    attendance: [],
    attendanceSettings: [],
    biometricTerminals: [],
  };
}

function ensureFirestore(): Firestore {
  if (!firebaseReady || !db) {
    throw new Error("Chargement Firestore impossible.");
  }
  return db as unknown as Firestore;
}

async function loadCollection<T>(collectionName: string) {
  const database = ensureFirestore();
  const snapshot = await getDocs(collection(database, collectionName));
  return snapshot.docs.map((item) => normalizeSchoolDomainDocument(collectionName, { id: item.id, ...item.data() })) as T[];
}

function normalizeSchoolDomainDocument(collectionName: string, value: Record<string, unknown>) {
  if (collectionName === "schools") return { ...value, schoolOptions: normalizeSchoolOptions(value.schoolOptions) };
  if (collectionName === "students" && typeof value.option === "string") return { ...value, option: canonicalSchoolOption(value.option) };
  return value;
}

async function loadOptionalCollection<T>(collectionName: string) {
  try {
    return await loadCollection<T>(collectionName);
  } catch (error) {
    console.warn(`Chargement optionnel ignore (${collectionName}).`, error);
    return [];
  }
}

async function loadSchoolCollection<T>(collectionName: string, schoolId: string) {
  const database = ensureFirestore();
  const snapshot = await getDocs(query(collection(database, collectionName), where("schoolId", "==", schoolId)));
  return snapshot.docs.map((item) => normalizeSchoolDomainDocument(collectionName, { id: item.id, ...item.data() })) as T[];
}

async function loadSchoolYearCollection<T>(collectionName: string, schoolId: string, schoolYearId: string) {
  const database = ensureFirestore();
  const snapshot = await getDocs(query(collection(database, collectionName), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)));
  return snapshot.docs.map((item) => normalizeSchoolDomainDocument(collectionName, { id: item.id, ...item.data() })) as T[];
}

async function loadOptionalSchoolCollection<T>(collectionName: string, schoolId: string) {
  try {
    return await loadSchoolCollection<T>(collectionName, schoolId);
  } catch (error) {
    console.warn(`Chargement optionnel ignore (${collectionName}) pour l'ecole ${schoolId}.`, error);
    return [];
  }
}

export async function loadSuperAdminInitialData(userId: string, authenticatedUser?: AppUser) {
  const database = ensureFirestore();
  let userProfile = authenticatedUser;
  if (!userProfile) {
    userProfile = await getDoc(doc(database, "users", userId)).then((userSnapshot) => {
      if (!userSnapshot.exists()) {
        throw new Error("Chargement Firestore impossible : profil Super Administrateur introuvable.");
      }
      return { id: userSnapshot.id, ...userSnapshot.data() } as AppUser;
    });
  }
  if (!userProfile) {
    throw new Error("Chargement Firestore impossible : profil Super Administrateur introuvable.");
  }

  // Lot SA-2b : plus aucun chargement de toutes les écoles ni de toutes les années à l'ouverture.
  // Une école (et ses années) se charge à l'ouverture de son drawer ; toutes les écoles seulement pour les écrans
  // qui en ont encore besoin (voir `loadAllPlatformSchools`).
  const biometricTerminals = await loadOptionalCollection<BiometricTerminal>("biometricTerminals");

  const data = emptySuperAdminData();
  data.users = [userProfile];
  data.biometricTerminals = biometricTerminals;

  return { data };
}

/** Lot SA-2b : une école et ses années scolaires (ouverture de son drawer). */
export async function loadPlatformSchoolWithYears(schoolId: string): Promise<{ school: School | null; schoolYears: SchoolYear[] }> {
  const database = ensureFirestore();
  const [schoolSnapshot, yearsSnapshot] = await Promise.all([
    getDoc(doc(database, "schools", schoolId)),
    getDocs(query(collection(database, "schoolYears"), where("schoolId", "==", schoolId))),
  ]);
  const school = schoolSnapshot.exists() ? normalizeSchoolDomainDocument("schools", { id: schoolSnapshot.id, ...schoolSnapshot.data() }) as unknown as School : null;
  return { school, schoolYears: yearsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SchoolYear) };
}

/** Lot SA-2b : toutes les écoles et années, seulement pour les écrans qui en ont encore besoin (lots 5 et 6 à venir). */
export async function loadAllPlatformSchools(): Promise<{ schools: School[]; schoolYears: SchoolYear[] }> {
  const [schools, schoolYears] = await Promise.all([loadCollection<School>("schools"), loadCollection<SchoolYear>("schoolYears")]);
  return { schools, schoolYears };
}

export async function loadSuperAdminSchoolData(schoolId: string, schoolYearId: string): Promise<SuperAdminSchoolData> {
  const [students, parents, feeTypes, payments, expenses, messages, notifications, auditLogs, valves, biometricTerminals, users] = await Promise.all([
    loadSchoolYearCollection<Student>("students", schoolId, schoolYearId),
    // Parent profiles can retain their source year after an annual transition;
    // their studentIds are filtered against the selected annual student set by
    // the platform statistics instead of being dropped here.
    loadSchoolCollection<ParentProfile>("parents", schoolId),
    loadSchoolYearCollection<FeeType>("feeTypes", schoolId, schoolYearId),
    loadSchoolYearCollection<Payment>("payments", schoolId, schoolYearId),
    loadSchoolYearCollection<Expense>("expenses", schoolId, schoolYearId),
    loadSchoolYearCollection<Message>("messages", schoolId, schoolYearId),
    loadSchoolYearCollection<AppData["notifications"][number]>("notifications", schoolId, schoolYearId),
    loadSchoolYearCollection<AuditLog>("auditLogs", schoolId, schoolYearId),
    loadSchoolYearCollection<ValvePublication>("valves", schoolId, schoolYearId),
    loadOptionalSchoolCollection<BiometricTerminal>("biometricTerminals", schoolId),
    loadSchoolCollection<AppUser>("users", schoolId),
  ]);

  return {
    students,
    parents,
    feeTypes,
    payments,
    expenses,
    messages,
    notifications,
    auditLogs,
    valves,
    biometricTerminals,
    users,
    admins: users.filter((item) => item.role === "school_admin"),
  };
}
