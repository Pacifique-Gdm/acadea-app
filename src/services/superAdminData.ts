import { collection, doc, getCountFromServer, getDoc, getDocs, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppData, AppUser, AuditLog, BiometricTerminal, Expense, FeeType, Message, ParentProfile, Payment, School, SchoolYear, Student, ValvePublication } from "../types";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../utils/schoolOptions";

export type SuperAdminGlobalCounts = {
  students: number;
  parents: number;
  admins: number;
};

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

async function loadOptionalSchoolCollection<T>(collectionName: string, schoolId: string) {
  try {
    return await loadSchoolCollection<T>(collectionName, schoolId);
  } catch (error) {
    console.warn(`Chargement optionnel ignore (${collectionName}) pour l'ecole ${schoolId}.`, error);
    return [];
  }
}

async function loadGlobalCount(collectionName: string, filters: [string, unknown][] = []) {
  const database = ensureFirestore();
  const constraints = filters.map(([field, value]) => where(field, "==", value));
  const snapshot = await getCountFromServer(query(collection(database, collectionName), ...constraints));
  return snapshot.data().count;
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

  const [schools, schoolYears, biometricTerminals, studentsCount, parentsCount, adminsCount] = await Promise.all([
    loadCollection<School>("schools"),
    loadCollection<SchoolYear>("schoolYears"),
    loadOptionalCollection<BiometricTerminal>("biometricTerminals"),
    loadGlobalCount("students"),
    loadGlobalCount("parents"),
    loadGlobalCount("users", [["role", "school_admin"]]),
  ]);

  const data = emptySuperAdminData();
  data.users = [userProfile];
  data.schools = schools;
  data.schoolYears = schoolYears;
  data.biometricTerminals = biometricTerminals;

  return {
    data,
    counts: {
      students: studentsCount,
      parents: parentsCount,
      admins: adminsCount,
    } satisfies SuperAdminGlobalCounts,
  };
}

export async function loadSuperAdminSchoolData(schoolId: string): Promise<SuperAdminSchoolData> {
  const [students, parents, feeTypes, payments, expenses, messages, notifications, auditLogs, valves, biometricTerminals, users] = await Promise.all([
    loadSchoolCollection<Student>("students", schoolId),
    loadSchoolCollection<ParentProfile>("parents", schoolId),
    loadSchoolCollection<FeeType>("feeTypes", schoolId),
    loadSchoolCollection<Payment>("payments", schoolId),
    loadSchoolCollection<Expense>("expenses", schoolId),
    loadSchoolCollection<Message>("messages", schoolId),
    loadSchoolCollection<AppData["notifications"][number]>("notifications", schoolId),
    loadSchoolCollection<AuditLog>("auditLogs", schoolId),
    loadSchoolCollection<ValvePublication>("valves", schoolId),
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
