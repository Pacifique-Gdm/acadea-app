import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db, firebaseReady } from "../firebase";
import { loadSuperAdminInitialData } from "./superAdminData";
import type { AppData, AppUser } from "../types";
import { resolveDefaultSchoolYear } from "../utils/schoolYears";

type CollectionKey = keyof AppData;
type PersistableItem = { id: string };
type PersistFirestorePatchOptions = {
  throwOnError?: boolean;
};
export type FirestoreYearData = Partial<Pick<AppData, "students" | "parents" | "feeTypes" | "payments" | "expenses" | "messages" | "valves" | "attendance" | "attendanceSettings">>;
export type DisciplineYearData = Pick<AppData, "students" | "parents" | "messages" | "notifications" | "disciplineSanctions" | "attendance" | "attendanceSettings" | "valves">;
export type ParentPortalData = Pick<AppData, "feeTypes" | "students" | "parents" | "payments" | "messages" | "valves">;
export type PlatformSettings = {
  loginLogoUrl?: string;
  updatedAt?: string;
};

export type FirestoreBootstrapData = Pick<AppData, "users" | "schools" | "schoolYears">;

const collectionMap: Partial<Record<CollectionKey, string>> = {
  users: "users",
  schools: "schools",
  schoolYears: "schoolYears",
  students: "students",
  parents: "parents",
  feeTypes: "feeTypes",
  payments: "payments",
  expenses: "expenses",
  messages: "messages",
  notifications: "notifications",
  valves: "valves",
  disciplineSanctions: "disciplineSanctions",
  attendance: "attendance",
  attendanceSettings: "attendanceSettings",
  biometricTerminals: "biometricTerminals",
};

export function canUseFirestoreData() {
  return firebaseReady && Boolean(db);
}

function emptyFirestoreData(): AppData {
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

function withFirestoreTimeout<T>(operation: Promise<T>, context: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(`Chargement Firestore trop long : ${context}.`));
    }, 15000);
    operation.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class FirestoreDataError extends Error {
  readonly code: string;
  readonly collectionPath: string;

  constructor(collectionPath: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    super(`Chargement Firestore impossible pour ${collectionPath} : ${message}`);
    this.name = "FirestoreDataError";
    this.collectionPath = collectionPath;
    this.code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
  }
}

function describeFirestoreError(collectionName: string, error: unknown) {
  return new FirestoreDataError(collectionName, error);
}

export function getYearRefreshScope(role: AppUser["role"]) {
  return role === "secretary" ? "secretary" : "school";
}

async function loadCollection<T>(collectionName: string, filters: [string, unknown][]) {
  if (!db) return [];

  const constraints = filters.map(([field, value]) => where(field, "==", value));
  const snapshot = await withFirestoreTimeout(getDocs(query(collection(db, collectionName), ...constraints)), collectionName).catch((error) => {
    throw describeFirestoreError(collectionName, error);
  });
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as T[];
}

async function loadAttendanceCollection(filters: [string, unknown][]) {
  try {
    return await loadCollection<AppData["attendance"][number]>("attendance", filters);
  } catch (error) {
    console.warn("Chargement des présences impossible. Vérifiez le déploiement des règles Firestore attendance.", error);
    return [];
  }
}

async function loadAttendanceSettingsCollection(filters: [string, unknown][]) {
  try {
    return await loadCollection<AppData["attendanceSettings"][number]>("attendanceSettings", filters);
  } catch (error) {
    console.warn("Chargement des paramètres de présence impossible. Vérifiez le déploiement des règles Firestore attendanceSettings.", error);
    return [];
  }
}

async function loadValvesCollection(filters: [string, unknown][]) {
  try {
    return await loadCollection<AppData["valves"][number]>("valves", filters);
  } catch (error) {
    console.warn("Chargement des Valves impossible. Vérifiez le déploiement des règles Firestore valves.", error);
    return [];
  }
}

async function loadDocument<T>(collectionName: string, id?: string) {
  if (!db || !id) return [];

  const snapshot = await withFirestoreTimeout(getDoc(doc(db, collectionName, id)), `${collectionName}/${id}`).catch((error) => {
    throw describeFirestoreError(`${collectionName}/${id}`, error);
  });
  return snapshot.exists() ? ([{ id: snapshot.id, ...snapshot.data() }] as T[]) : [];
}

export async function loadFirestoreBootstrapData(user: AppUser): Promise<FirestoreBootstrapData | null> {
  if (!canUseFirestoreData() || !db) return null;
  if (!user.schoolId) {
    throw new Error("Chargement Firestore impossible : schoolId manquant dans les Custom Claims.");
  }

  const schoolFilter: [string, unknown][] = [["schoolId", user.schoolId]];
  const [schools, schoolYears] = await Promise.all([
    loadDocument<AppData["schools"][number]>("schools", user.schoolId),
    loadCollection<AppData["schoolYears"][number]>("schoolYears", schoolFilter),
  ]);
  if (schools.length === 0) {
    throw new Error("Chargement Firestore impossible : ecole introuvable pour ce schoolId.");
  }
  if (schools[0].status === "suspended") {
    throw new Error("Connexion refusee : cette ecole est suspendue.");
  }
  if (schools[0].status === "deleting" || schools[0].status === "inactive") {
    throw new Error("Connexion refusee : cette ecole n'est pas active.");
  }

  return { users: [user], schools, schoolYears };
}

async function loadSchoolMessages(user: AppUser, schoolId: string, schoolYearId: string) {
  if (!db) return [];
  const base = [where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)];
  const legacyRecipients = user.role === "cashier" ? ["cashier", "both"] : ["admin", "both"];
  const [legacy, personal] = await Promise.all([
    withFirestoreTimeout(getDocs(query(collection(db, "messages"), ...base, where("schoolRecipient", "in", legacyRecipients))), "messages"),
    withFirestoreTimeout(getDocs(query(collection(db, "messages"), ...base, where("participantIds", "array-contains", user.id))), "messages"),
  ]).catch((error) => { throw describeFirestoreError("messages", error); });
  return Array.from(new Map([...legacy.docs, ...personal.docs].map((item) => [item.id, { id: item.id, ...item.data() } as AppData["messages"][number]])).values());
}

export async function loadFirestoreData(user?: AppUser, schoolYearId?: string, bootstrapData?: FirestoreBootstrapData) {
  if (!canUseFirestoreData() || !db) return null;

  if (user?.role === "super_admin") {
    const { data } = await loadSuperAdminInitialData(user.id);
    return data;
  }

  if (user?.role) {
    const scopedData = emptyFirestoreData();
    const schoolFilter: [string, unknown][] = [["schoolId", user.schoolId]];
    const parentFilter: [string, unknown][] = [
      ["schoolId", user.schoolId],
      ["parentId", user.parentId],
    ];

    if (!user.schoolId) {
      throw new Error("Chargement Firestore impossible : schoolId manquant dans les Custom Claims.");
    }

    if (bootstrapData) {
      scopedData.users = bootstrapData.users;
      scopedData.schools = bootstrapData.schools;
      scopedData.schoolYears = bootstrapData.schoolYears;
    } else {
      scopedData.users = await loadDocument<AppData["users"][number]>("users", user.id);
      if (scopedData.users.length === 0) {
        throw new Error("Chargement Firestore impossible : profil users/{uid} introuvable.");
      }
      const bootstrap = await loadFirestoreBootstrapData(user);
      if (!bootstrap) return null;
      scopedData.schools = bootstrap.schools;
      scopedData.schoolYears = bootstrap.schoolYears;
    }
    const requestedYear = schoolYearId ? scopedData.schoolYears.find((year) => year.id === schoolYearId && year.schoolId === user.schoolId) : undefined;
    const defaultYear = resolveDefaultSchoolYear(scopedData.schools[0], scopedData.schoolYears);
    const targetSchoolYearId = requestedYear?.id ?? defaultYear?.id;
    const annualFilter: [string, unknown][] = targetSchoolYearId
      ? [
          ["schoolId", user.schoolId],
          ["schoolYearId", targetSchoolYearId],
        ]
      : schoolFilter;

    if (user.role === "study_director") return scopedData;

    if (user.role === "parent") {
      if (!user.parentId) {
        throw new Error("Chargement Firestore impossible : parentId manquant dans les Custom Claims.");
      }

      [scopedData.feeTypes, scopedData.students, scopedData.parents, scopedData.payments, scopedData.messages, scopedData.valves] = await Promise.all([
        loadCollection<AppData["feeTypes"][number]>("feeTypes", schoolFilter),
        loadCollection<AppData["students"][number]>("students", parentFilter),
        loadDocument<AppData["parents"][number]>("parents", user.parentId),
        loadCollection<AppData["payments"][number]>("payments", parentFilter),
        loadCollection<AppData["messages"][number]>("messages", [["schoolId", user.schoolId], ["threadParentId", user.parentId]]),
        loadCollection<AppData["valves"][number]>("valves", schoolFilter),
      ]);
      return scopedData;
    }

    if (user.role === "discipline_director") {
      [scopedData.students, scopedData.parents, scopedData.messages, scopedData.notifications, scopedData.disciplineSanctions, scopedData.attendance, scopedData.attendanceSettings, scopedData.valves] = await Promise.all([
        loadCollection<AppData["students"][number]>("students", annualFilter),
        loadCollection<AppData["parents"][number]>("parents", schoolFilter),
        loadCollection<AppData["messages"][number]>("messages", [...annualFilter, ["schoolRecipient", "discipline"]]),
        loadCollection<AppData["notifications"][number]>("notifications", [...annualFilter, ["recipientRole", "school"], ["schoolRecipient", "discipline"]]),
        loadCollection<AppData["disciplineSanctions"][number]>("disciplineSanctions", annualFilter),
        loadAttendanceCollection(annualFilter),
        loadAttendanceSettingsCollection(annualFilter),
        loadValvesCollection(annualFilter),
      ]);
      return scopedData;
    }

    if (user.role === "secretary") {
      [scopedData.students, scopedData.parents, scopedData.feeTypes, scopedData.payments] = await Promise.all([
        loadCollection<AppData["students"][number]>("students", schoolFilter),
        loadCollection<AppData["parents"][number]>("parents", schoolFilter),
        loadCollection<AppData["feeTypes"][number]>("feeTypes", annualFilter),
        loadCollection<AppData["payments"][number]>("payments", annualFilter),
      ]);
      return scopedData;
    }

    const commonLoads = await Promise.all([
      loadCollection<AppData["feeTypes"][number]>("feeTypes", annualFilter),
      loadCollection<AppData["students"][number]>("students", annualFilter),
      loadCollection<AppData["parents"][number]>("parents", schoolFilter),
      loadCollection<AppData["payments"][number]>("payments", annualFilter),
      loadCollection<AppData["expenses"][number]>("expenses", annualFilter),
      loadSchoolMessages(user, user.schoolId, schoolYearId as string),
      loadCollection<AppData["valves"][number]>("valves", annualFilter),
    ]);
    [scopedData.feeTypes, scopedData.students, scopedData.parents, scopedData.payments, scopedData.expenses, scopedData.messages, scopedData.valves] = commonLoads;
    if (user.role === "school_admin") {
      [scopedData.auditLogs, scopedData.attendance, scopedData.attendanceSettings] = await Promise.all([
        loadCollection<AppData["auditLogs"][number]>("auditLogs", schoolFilter),
        loadAttendanceCollection(annualFilter),
        loadAttendanceSettingsCollection(annualFilter),
      ]);
    }
    return scopedData;
  }

  return emptyFirestoreData();

}

export async function loadDisciplineYearData(user: AppUser, schoolYearId: string) {
  if (!canUseFirestoreData() || !db) return null;
  if (!user.schoolId) {
    throw new Error("Chargement Firestore impossible : schoolId manquant dans les Custom Claims.");
  }
  if (!schoolYearId) {
    throw new Error("Chargement Firestore impossible : schoolYearId manquant.");
  }

  const annualFilter: [string, unknown][] = [
    ["schoolId", user.schoolId],
    ["schoolYearId", schoolYearId],
  ];
  const schoolFilter: [string, unknown][] = [["schoolId", user.schoolId]];

  const yearData: DisciplineYearData = {
    students: await loadCollection<AppData["students"][number]>("students", annualFilter),
    parents: await loadCollection<AppData["parents"][number]>("parents", schoolFilter),
    messages: await loadCollection<AppData["messages"][number]>("messages", [...annualFilter, ["schoolRecipient", "discipline"]]),
    notifications: await loadCollection<AppData["notifications"][number]>("notifications", [...annualFilter, ["recipientRole", "school"], ["schoolRecipient", "discipline"]]),
    disciplineSanctions: await loadCollection<AppData["disciplineSanctions"][number]>("disciplineSanctions", annualFilter),
    attendance: await loadAttendanceCollection(annualFilter),
    attendanceSettings: await loadAttendanceSettingsCollection(annualFilter),
    valves: await loadValvesCollection(annualFilter),
  };

  return yearData;
}

export async function loadParentPortalData(user: AppUser) {
  if (!canUseFirestoreData() || !db) return null;
  if (!user.schoolId) {
    throw new Error("Chargement Firestore impossible : schoolId manquant dans les Custom Claims.");
  }
  if (!user.parentId) {
    throw new Error("Chargement Firestore impossible : parentId manquant dans les Custom Claims.");
  }

  const schoolFilter: [string, unknown][] = [["schoolId", user.schoolId]];
  const parentFilter: [string, unknown][] = [
    ["schoolId", user.schoolId],
    ["parentId", user.parentId],
  ];

  const parentData: ParentPortalData = {
    feeTypes: await loadCollection<AppData["feeTypes"][number]>("feeTypes", schoolFilter),
    students: await loadCollection<AppData["students"][number]>("students", parentFilter),
    parents: await loadDocument<AppData["parents"][number]>("parents", user.parentId),
    payments: await loadCollection<AppData["payments"][number]>("payments", parentFilter),
    messages: await loadCollection<AppData["messages"][number]>("messages", [
      ["schoolId", user.schoolId],
      ["threadParentId", user.parentId],
    ]),
    valves: await loadCollection<AppData["valves"][number]>("valves", schoolFilter),
  };

  return parentData;
}

export async function loadFirestoreYearData(user: AppUser, schoolYearId: string) {
  if (!canUseFirestoreData() || !db) return null;
  if (!user.schoolId) {
    throw new Error("Chargement Firestore impossible : schoolId manquant dans les Custom Claims.");
  }
  if (!schoolYearId) {
    throw new Error("Chargement Firestore impossible : schoolYearId manquant.");
  }

  const annualFilter: [string, unknown][] = [
    ["schoolId", user.schoolId],
    ["schoolYearId", schoolYearId],
  ];

  if (getYearRefreshScope(user.role) === "secretary") {
    const schoolFilter: [string, unknown][] = [["schoolId", user.schoolId]];
    const [students, parents, feeTypes, payments] = await Promise.all([
      loadCollection<AppData["students"][number]>("students", schoolFilter),
      loadCollection<AppData["parents"][number]>("parents", schoolFilter),
      loadCollection<AppData["feeTypes"][number]>("feeTypes", annualFilter),
      loadCollection<AppData["payments"][number]>("payments", annualFilter),
    ]);
    return { students, parents, feeTypes, payments };
  }

  const yearData: FirestoreYearData = {
    students: await loadCollection<AppData["students"][number]>("students", annualFilter),
    feeTypes: await loadCollection<AppData["feeTypes"][number]>("feeTypes", annualFilter),
    payments: await loadCollection<AppData["payments"][number]>("payments", annualFilter),
    expenses: await loadCollection<AppData["expenses"][number]>("expenses", annualFilter),
    messages: await loadSchoolMessages(user, user.schoolId, schoolYearId),
    valves: await loadCollection<AppData["valves"][number]>("valves", annualFilter),
    attendance: await loadAttendanceCollection(annualFilter),
    attendanceSettings: await loadAttendanceSettingsCollection(annualFilter),
  };

  return yearData;
}

export async function loadPlatformSettings() {
  if (!canUseFirestoreData() || !db) return null;

  const snapshot = await withFirestoreTimeout(getDoc(doc(db, "publicConfig", "appConfig")), "publicConfig/appConfig").catch((error) => {
    throw describeFirestoreError("publicConfig/appConfig", error);
  });
  return snapshot.exists() ? (snapshot.data() as PlatformSettings) : {};
}

export async function savePlatformSettings(settings: PlatformSettings) {
  if (!canUseFirestoreData() || !db) return false;

  const documentRef = doc(db, "publicConfig", "appConfig");
  const snapshot = await getDoc(documentRef);
  const currentSettings = snapshot.exists() ? (snapshot.data() as PlatformSettings) : {};
  await setDoc(documentRef, { ...currentSettings, ...settings });
  return true;
}

export async function persistFirestorePatch(patch: Partial<AppData>, options: PersistFirestorePatchOptions = {}) {
  if (!canUseFirestoreData() || !db) return false;

  await Promise.all(
    (Object.entries(patch) as [CollectionKey, AppData[CollectionKey]][])
      .filter(([key, items]) => collectionMap[key] && Array.isArray(items))
      .map(async ([key, items]) => {
        const collectionName = collectionMap[key];
        if (!collectionName) return;
        await Promise.all(
          (items as PersistableItem[]).map((item) =>
            setDoc(doc(db, collectionName, item.id), item).catch((error) => {
              if (options.throwOnError) {
                throw error;
              }
              console.warn(`Document Firestore ignoré (${collectionName}/${item.id}).`, error);
            }),
          ),
        );
      }),
  );

  return true;
}
