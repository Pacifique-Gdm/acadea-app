import * as firestore from "firebase/firestore";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, School } from "../types";
import { canUseFirestoreData } from "./firestoreData";

const serverTimestamp = (firestore as unknown as { serverTimestamp: () => unknown }).serverTimestamp;

export function isSchoolAiAssistantEnabled(school: Pick<School, "aiAssistant"> | null | undefined) {
  return school?.aiAssistant?.enabled === true;
}

export async function saveSchoolAiAssistantSetting(user: AppUser, schoolId: string, enabled: boolean): Promise<NonNullable<School["aiAssistant"]>> {
  if (user.role !== "super_admin" || user.status === "inactive") {
    throw new Error("Seul un Super Administrateur actif peut modifier l’Assistant IA.");
  }
  if (!schoolId) throw new Error("Établissement introuvable.");

  const localValue = { enabled, updatedAt: new Date().toISOString(), updatedBy: user.id };
  if (canUseFirestoreData() && db) {
    const schoolRef = doc(db, "schools", schoolId);
    await setDoc(schoolRef, { aiAssistant: { enabled, updatedAt: serverTimestamp(), updatedBy: user.id } }, { merge: true });
    const savedSchool = await getDoc(schoolRef);
    const savedSetting = savedSchool.data()?.aiAssistant as School["aiAssistant"];
    if (savedSetting) return savedSetting;
  }
  return localValue;
}
