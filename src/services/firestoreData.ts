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
export type FirestoreYearData = Pick<AppData, "students" | "feeTypes" | "payments" | "expenses" | "messages" | "valves" | "attendance" | "attendanceSettings">;
export type DisciplineYearData = Pick<AppData, "students" | "parents" | "messages" | "notifications" | "disciplineSanctions" | "attendance" | "attendanceSettings" | "valves">;
export type ParentPortalData = Pick<AppData, "feeTypes" | "students" | "parents" | "payments" | "messages" | "valves">;
export type PlatformSettings = {
  loginLogoUrl?: string;
  updatedAt?: string;
};

const collectionMap: Record<CollectionKey, string> = {
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
  auditLogs: "auditLogs",
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
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`Chargement Firestore trop long : ${context}.`));
      }, 15000);
    }),
  ]);
}

function describeFirestoreError(collectionName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Chargement Firestore impossible pour ${collectionName} : ${message}`);
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
    console.warn("Chargement des paramÃ¨tres de prÃ©sence impossible. VÃ©rifiez le dÃ©ploiement des rÃ¨gles Firestore attendanceSettings.", error);
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

export async function loadFirestoreData(user?: AppUser, schoolYearId?: string) {
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

    scopedData.users = await loadDocument<AppData["users"][number]>("users", user.id);
    if (scopedData.users.length === 0) {
      throw new Error("Chargement Firestore impossible : profil users/{uid} introuvable.");
    }

    scopedData.schools = await loadDocument<AppData["schools"][number]>("schools", user.schoolId);
    if (scopedData.schools.length === 0) {
      throw new Error("Chargement Firestore impossible : ecole introuvable pour ce schoolId.");
    }
    if (scopedData.schools[0].status === "suspended") {
      throw new Error("Connexion refusee : cette ecole est suspendue.");
    }

    scopedData.schoolYears = await loadCollection<AppData["schoolYears"][number]>("schoolYears", schoolFilter);
    const requestedYear = schoolYearId ? scopedData.schoolYears.find((year) => year.id === schoolYearId && year.schoolId === user.schoolId) : undefined;
    const defaultYear = resolveDefaultSchoolYear(scopedData.schools[0], scopedData.schoolYears);
    const targetSchoolYearId = requestedYear?.id ?? defaultYear?.id;
    const annualFilter: [string, unknown][] = targetSchoolYearId
      ? [
          ["schoolId", user.schoolId],
          ["schoolYearId", targetSchoolYearId],
        ]
      : schoolFilter;

    if (user.role === "parent") {
      scopedData.feeTypes = await loadCollection<AppData["feeTypes"][number]>("feeTypes", schoolFilter);
      if (!user.parentId) {
        throw new Error("Chargement Firestore impossible : parentId manquant dans les Custom Claims.");
      }

      scopedData.students = await loadCollection<AppData["students"][number]>("students", parentFilter);
      scopedData.parents = await loadDocument<AppData["parents"][number]>("parents", user.parentId);
      scopedData.payments = await loadCollection<AppData["payments"][number]>("payments", parentFilter);
      scopedData.messages = await loadCollection<AppData["messages"][number]>("messages", [
        ["schoolId", user.schoolId],
        ["threadParentId", user.parentId],
      ]);
      scopedData.valves = await loadCollection<AppData["valves"][number]>("valves", schoolFilter);
      return scopedData;
    }

    if (user.role === "discipline_director") {
      scopedData.students = await loadCollection<AppData["students"][number]>("students", annualFilter);
      scopedData.parents = await loadCollection<AppData["parents"][number]>("parents", schoolFilter);
      scopedData.messages = await loadCollection<AppData["messages"][number]>("messages", [...annualFilter, ["schoolRecipient", "discipline"]]);
      scopedData.notifications = await loadCollection<AppData["notifications"][number]>("notifications", [...annualFilter, ["recipientRole", "school"], ["schoolRecipient", "discipline"]]);
      scopedData.disciplineSanctions = await loadCollection<AppData["disciplineSanctions"][number]>("disciplineSanctions", annualFilter);
      scopedData.attendance = await loadAttendanceCollection(annualFilter);
      scopedData.attendanceSettings = await loadAttendanceSettingsCollection(annualFilter);
      scopedData.valves = await loadValvesCollection(annualFilter);
      return scopedData;
    }

    scopedData.feeTypes = await loadCollection<AppData["feeTypes"][number]>("feeTypes", annualFilter);
    scopedData.students = await loadCollection<AppData["students"][number]>("students", annualFilter);
    scopedData.parents = await loadCollection<AppData["parents"][number]>("parents", schoolFilter);
    scopedData.payments = await loadCollection<AppData["payments"][number]>("payments", annualFilter);
    scopedData.expenses = await loadCollection<AppData["expenses"][number]>("expenses", annualFilter);
    scopedData.messages = await loadCollection<AppData["messages"][number]>("messages", annualFilter);
    if (user.role === "school_admin") {
      scopedData.auditLogs = await loadCollection<AppData["auditLogs"][number]>("auditLogs", schoolFilter);
      scopedData.attendance = await loadAttendanceCollection(annualFilter);
      scopedData.attendanceSettings = await loadAttendanceSettingsCollection(annualFilter);
    }
    scopedData.valves = await loadCollection<AppData["valves"][number]>("valves", annualFilter);
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

  const yearData: FirestoreYearData = {
    students: await loadCollection<AppData["students"][number]>("students", annualFilter),
    feeTypes: await loadCollection<AppData["feeTypes"][number]>("feeTypes", annualFilter),
    payments: await loadCollection<AppData["payments"][number]>("payments", annualFilter),
    expenses: await loadCollection<AppData["expenses"][number]>("expenses", annualFilter),
    messages: await loadCollection<AppData["messages"][number]>("messages", annualFilter),
    valves: await loadCollection<AppData["valves"][number]>("valves", annualFilter),
    attendance: await loadAttendanceCollection(annualFilter),
    attendanceSettings: await loadAttendanceSettingsCollection(annualFilter),
  };

  return yearData;
}

export async function loadPlatformSettings() {
  if (!canUseFirestoreData() || !db) return null;

  const snapshot = await withFirestoreTimeout(getDoc(doc(db, "platform", "appConfig")), "platform/appConfig").catch((error) => {
    throw describeFirestoreError("platform/appConfig", error);
  });
  return snapshot.exists() ? (snapshot.data() as PlatformSettings) : {};
}

export async function savePlatformSettings(settings: PlatformSettings) {
  if (!canUseFirestoreData() || !db) return false;

  const documentRef = doc(db, "platform", "appConfig");
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
