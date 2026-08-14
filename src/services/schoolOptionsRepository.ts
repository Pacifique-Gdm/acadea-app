import { doc, runTransaction } from "firebase/firestore";
import { db } from "../firebase";
import type { School } from "../types";
import { canonicalSchoolOption, mergeSchoolOptions, normalizeSchoolOptions, reconcileSchoolOptions } from "../utils/schoolOptions";

export async function persistSchoolOption(schoolId: string, option: string) {
  if (!db) throw new Error("Persistance Firestore indisponible.");
  const canonical = canonicalSchoolOption(option);
  if (!canonical) throw new Error("Le libellé de l'option est obligatoire.");
  const schoolRef = doc(db, "schools", schoolId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists()) throw new Error("École introuvable.");
    const current = snapshot.data() as Pick<School, "schoolOptions">;
    const schoolOptions = mergeSchoolOptions(current.schoolOptions, [canonical]);
    transaction.update(schoolRef, { schoolOptions });
    return { schoolOptions, option: canonical };
  });
}

export async function persistSchoolSettings(currentSchool: School, baselineOptions: unknown, desiredSchool: School) {
  if (!db) throw new Error("Persistance Firestore indisponible.");
  const schoolRef = doc(db, "schools", currentSchool.id);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists()) throw new Error("École introuvable.");
    const latest = { id: currentSchool.id, ...snapshot.data() } as School;
    const schoolOptions = reconcileSchoolOptions(latest.schoolOptions, baselineOptions, desiredSchool.schoolOptions);
    const settings = {
      name: desiredSchool.name,
      motto: desiredSchool.motto ?? "",
      address: desiredSchool.address,
      phone: desiredSchool.phone,
      email: desiredSchool.email,
      logoUrl: desiredSchool.logoUrl ?? "",
      acronym: desiredSchool.acronym ?? "",
      educationLevels: desiredSchool.educationLevels ?? [],
      schoolOptions: normalizeSchoolOptions(schoolOptions),
      schoolType: desiredSchool.schoolType ?? "Mixte",
      activeSchoolYearId: desiredSchool.activeSchoolYearId,
    } satisfies Partial<School>;
    const savedSchool: School = { ...latest, ...settings };
    transaction.update(schoolRef, settings);
    return savedSchool;
  });
}
