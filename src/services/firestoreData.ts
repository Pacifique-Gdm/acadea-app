import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppData, AppUser } from "../types";

type CollectionKey = keyof AppData;
type PersistableItem = { id: string };
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

async function loadDocument<T>(collectionName: string, id?: string) {
  if (!db || !id) return [];

  const snapshot = await withFirestoreTimeout(getDoc(doc(db, collectionName, id)), `${collectionName}/${id}`).catch((error) => {
    throw describeFirestoreError(`${collectionName}/${id}`, error);
  });
  return snapshot.exists() ? ([{ id: snapshot.id, ...snapshot.data() }] as T[]) : [];
}

export async function loadFirestoreData(user?: AppUser) {
  if (!canUseFirestoreData() || !db) return null;

  if (user?.role && user.role !== "super_admin") {
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
    scopedData.feeTypes = await loadCollection<AppData["feeTypes"][number]>("feeTypes", schoolFilter);

    if (user.role === "parent") {
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
      scopedData.notifications = await loadCollection<AppData["notifications"][number]>("notifications", parentFilter);
      scopedData.valves = await loadCollection<AppData["valves"][number]>("valves", schoolFilter);
      return scopedData;
    }

    scopedData.students = await loadCollection<AppData["students"][number]>("students", schoolFilter);
    scopedData.parents = await loadCollection<AppData["parents"][number]>("parents", schoolFilter);
    scopedData.payments = await loadCollection<AppData["payments"][number]>("payments", schoolFilter);
    scopedData.expenses = await loadCollection<AppData["expenses"][number]>("expenses", schoolFilter);
    scopedData.messages = await loadCollection<AppData["messages"][number]>("messages", schoolFilter);
    scopedData.notifications = await loadCollection<AppData["notifications"][number]>("notifications", schoolFilter);
    scopedData.auditLogs = await loadCollection<AppData["auditLogs"][number]>("auditLogs", schoolFilter);
    scopedData.valves = await loadCollection<AppData["valves"][number]>("valves", schoolFilter);
    return scopedData;
  }

  const entries = await Promise.all(
    (Object.entries(collectionMap) as [CollectionKey, string][]).map(async ([key, collectionName]) => {
      const snapshot = await getDocs(collection(db, collectionName)).catch((error) => {
        console.error("[Acadéa Firestore] Erreur getDocs collection.", {
          collectionName,
          error,
        });
        throw error;
      });
      console.log("[Acadéa Firestore] Collection chargée.", {
        collectionName,
        snapshotSize: snapshot.size,
        ids: snapshot.docs.map((item) => item.id),
      });
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      return [key, items] as const;
    }),
  );

  return Object.fromEntries(entries) as unknown as AppData;
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

export async function persistFirestorePatch(patch: Partial<AppData>) {
  if (!canUseFirestoreData() || !db) return false;

  await Promise.all(
    (Object.entries(patch) as [CollectionKey, AppData[CollectionKey]][])
      .filter(([key, items]) => collectionMap[key] && Array.isArray(items))
      .map(async ([key, items]) => {
        const collectionName = collectionMap[key];
        await Promise.all(
          (items as PersistableItem[]).map((item) =>
            setDoc(doc(db, collectionName, item.id), item).catch((error) => {
              console.warn(`Document Firestore ignoré (${collectionName}/${item.id}).`, error);
            }),
          ),
        );
      }),
  );

  return true;
}
