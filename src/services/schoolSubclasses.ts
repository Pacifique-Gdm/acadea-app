import { collection, doc, onSnapshot, query, where, writeBatch } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { AppUser, SchoolClassRecord } from "../types";

export function activeSubclasses(classes: SchoolClassRecord[], parentClassId: string) {
  return classes.filter((item) => item.parentClassId === parentClassId && item.active !== false);
}

export function operationalClasses(classes: SchoolClassRecord[]) {
  const subdivided = new Set(classes.filter((item) => item.parentClassId && item.active !== false).map((item) => item.parentClassId!));
  return classes.filter((item) => item.active !== false && (item.parentClassId || !subdivided.has(item.id)));
}

export function validateSubclassLabels(labels: string[]) {
  const clean = labels.map((label) => label.trim()).filter(Boolean);
  if (clean.length < 2) return "Une subdivision doit contenir au moins deux sous-classes.";
  const normalized = clean.map((label) => label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) return "Les libellés des sous-classes doivent être uniques.";
  return "";
}

export function subscribeToSchoolClasses(schoolId: string, schoolYearId: string, onData: (items: SchoolClassRecord[]) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined;
  return onSnapshot(query(collection(db as Firestore, "classes"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SchoolClassRecord));
  }, onError);
}

export async function createSchoolSubclasses(input: { user: AppUser; parent: SchoolClassRecord; labels: string[]; existing: SchoolClassRecord[] }) {
  if (!db || !["school_admin", "secretary"].includes(input.user.role) || input.user.schoolId !== input.parent.schoolId) throw new Error("Création de sous-classes non autorisée.");
  if (!input.parent.schoolYearId || input.user.activeSchoolYearId !== input.parent.schoolYearId) throw new Error("L’année scolaire de la classe est incohérente.");
  const error = validateSubclassLabels(input.labels);
  if (error) throw new Error(error);
  if (input.parent.parentClassId) throw new Error("Une sous-classe ne peut pas être subdivisée.");
  const normalizedExisting = new Set(activeSubclasses(input.existing, input.parent.id).map((item) => item.subClassLabel?.trim().toLocaleLowerCase()));
  const labels = input.labels.map((label) => label.trim());
  if (labels.some((label) => normalizedExisting.has(label.toLocaleLowerCase()))) throw new Error("Cette sous-classe existe déjà.");
  const database = db as Firestore;
  const batch = writeBatch(database);
  labels.forEach((label) => {
    const id = `${input.parent.id}__${crypto.randomUUID()}`;
    batch.set(doc(database, "classes", id), { id, schoolId: input.parent.schoolId, schoolYearId: input.parent.schoolYearId, name: `${input.parent.name} - ${label}`, parentClassId: input.parent.id, subClassLabel: label, active: true, createdBy: input.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
  await batch.commit();
}
