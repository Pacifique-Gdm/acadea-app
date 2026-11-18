import { deleteField, doc, runTransaction } from "firebase/firestore";
import { db } from "../firebase";
import type { School } from "../types";
import { canonicalSchoolOption, mergeSchoolOptions, normalizeSchoolOptions, reconcileSchoolOptions, schoolOptionDisplayName } from "../utils/schoolOptions";
import { getSchoolEducationLevels, toggleSchoolEducationLevel } from "../utils/schoolConfig";
import { SCHOOL_LOGO_COLLECTION, computeSchoolLogoVersion, primeSchoolLogo } from "./schoolLogo";

export async function persistSchoolOption(schoolId: string, option: string) {
  if (!db) throw new Error("Persistance Firestore indisponible.");
  const canonical = canonicalSchoolOption(option);
  if (!canonical) throw new Error("Le libellé de l'option est obligatoire.");
  const schoolRef = doc(db, "schools", schoolId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists()) throw new Error("École introuvable.");
    const current = snapshot.data() as Pick<School, "schoolOptions" | "schoolOptionDisplayNames">;
    if (normalizeSchoolOptions(current.schoolOptions).some((item) => item !== canonical && schoolOptionDisplayName(current, item).localeCompare(canonical, "fr", { sensitivity: "base" }) === 0)) {
      throw new Error("Une option de cette école porte déjà ce nom.");
    }
    const schoolOptions = mergeSchoolOptions(current.schoolOptions, [canonical]);
    transaction.update(schoolRef, { schoolOptions });
    return { schoolOptions, option: canonical };
  });
}

/**
 * `logoChange` n'est donné que si l'administrateur a changé le logo : le logo
 * est alors rangé à part dans `schoolLogos/{id}` et l'école ne garde que son
 * repère `logoVersion` (l'ancien champ `logoUrl` est retiré).
 */
export async function persistSchoolSettings(currentSchool: School, baselineOptions: unknown, desiredSchool: School, logoChange?: { logoUrl: string; updatedBy?: string }) {
  if (!db) throw new Error("Persistance Firestore indisponible.");
  const database = db;
  const schoolRef = doc(database, "schools", currentSchool.id);
  const logoUrl = logoChange?.logoUrl ?? "";
  const logoVersion = logoChange ? await computeSchoolLogoVersion(logoUrl) : "";
  const saved = await runTransaction(database, async (transaction) => {
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
      acronym: desiredSchool.acronym ?? "",
      schoolOptions: normalizeSchoolOptions(schoolOptions),
      activeSchoolYearId: desiredSchool.activeSchoolYearId,
    } satisfies Partial<School>;
    if (!logoChange) {
      transaction.update(schoolRef, settings);
      return { ...latest, ...settings } as School;
    }
    const logoRef = doc(database, SCHOOL_LOGO_COLLECTION, currentSchool.id);
    if (logoUrl) {
      transaction.set(logoRef, { schoolId: currentSchool.id, logoUrl, logoVersion, updatedAt: new Date().toISOString(), updatedBy: logoChange.updatedBy ?? "" });
    } else {
      transaction.delete(logoRef);
    }
    transaction.update(schoolRef, { ...settings, logoUrl: deleteField(), logoVersion });
    const savedSchool: School = { ...latest, ...settings, logoVersion };
    delete savedSchool.logoUrl;
    return savedSchool;
  });
  if (logoChange) primeSchoolLogo(currentSchool.id, logoVersion, logoUrl);
  return saved;
}

export async function persistSchoolEducationLevel(schoolId: string, level: string, wasChecked: boolean): Promise<School> {
  if (!db) throw new Error("Persistance Firestore indisponible.");
  const schoolRef = doc(db, "schools", schoolId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists()) throw new Error("École introuvable.");
    const latest = { id: schoolId, ...snapshot.data() } as School;
    const currentLevels = getSchoolEducationLevels(latest).filter((item) => item !== "Mixte");
    if (currentLevels.includes(level) !== wasChecked) {
      throw new Error("Cette section a changé depuis l'ouverture du formulaire. Réessayez avec son état actuel.");
    }
    const educationLevels = toggleSchoolEducationLevel(currentLevels, level);
    if (educationLevels.includes(level) === wasChecked) {
      throw new Error("L'école doit conserver au moins une section.");
    }
    const schoolType = educationLevels.length === 1 ? educationLevels[0] as School["schoolType"] : "Mixte";
    transaction.update(schoolRef, { educationLevels, schoolType });
    return { ...latest, educationLevels, schoolType };
  });
}
