import { doc, getDoc, runTransaction } from "firebase/firestore";
import { db } from "../firebase";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../utils/schoolOptions";

const catalogPath = ["platformSettings", "schoolOptionsCatalog"] as const;

export async function loadSchoolOptionCatalog(): Promise<string[]> {
  if (!db) throw new Error("Catalogue des options indisponible.");
  const snapshot = await getDoc(doc(db, ...catalogPath));
  return snapshot.exists() ? normalizeSchoolOptions(snapshot.data().options) : [];
}

export async function addSchoolOptionToCatalog(option: string): Promise<string[]> {
  if (!db) throw new Error("Catalogue des options indisponible.");
  const canonical = canonicalSchoolOption(option);
  if (!canonical || canonical === "Autre") throw new Error("Option scolaire invalide.");
  const reference = doc(db, ...catalogPath);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists() ? normalizeSchoolOptions(snapshot.data()?.options) : [];
    const merged = normalizeSchoolOptions([...current, canonical]);
    if (merged.length === current.length) throw new Error("Cette option existe déjà dans le catalogue.");
    transaction.set(reference, { options: merged, updatedAt: new Date().toISOString() });
    return merged;
  });
}
