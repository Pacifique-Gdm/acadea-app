import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AppData } from "../types";

type CollectionKey = keyof AppData;
type PersistableItem = { id: string };

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
};

export function canUseFirestoreData() {
  return firebaseReady && Boolean(db);
}

export async function loadFirestoreData() {
  if (!canUseFirestoreData() || !db) return null;

  const entries = await Promise.all(
    (Object.entries(collectionMap) as [CollectionKey, string][]).map(async ([key, collectionName]) => {
      const snapshot = await getDocs(collection(db, collectionName));
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      return [key, items] as const;
    }),
  );

  return Object.fromEntries(entries) as unknown as AppData;
}

export async function persistFirestorePatch(patch: Partial<AppData>) {
  if (!canUseFirestoreData() || !db) return false;

  await Promise.all(
    (Object.entries(patch) as [CollectionKey, AppData[CollectionKey]][])
      .filter(([key, items]) => collectionMap[key] && Array.isArray(items))
      .map(async ([key, items]) => {
        const collectionName = collectionMap[key];
        await Promise.all(
          (items as PersistableItem[]).map((item) => setDoc(doc(db, collectionName, item.id), item)),
        );
      }),
  );

  return true;
}
