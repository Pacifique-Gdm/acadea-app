import type { School } from "../../types";
import { educationLevelsForSchoolLevel, schoolLevelFromConfig } from "../../utils/schoolConfig";
import type { SchoolLevelChoice } from "../../utils/schoolConfig";

export const SCHOOL_INFORMATION_CONFIRMATION = "MODIFIER INFORMATIONS ÉCOLE";

export type SchoolInformationDraft = {
  name: string;
  address: string;
  phone: string;
  email: string;
  motto: string;
  logoUrl: string;
  timeZone: string;
  level: SchoolLevelChoice;
};

export function schoolInformationDraft(school: School): SchoolInformationDraft {
  return {
    name: school.name,
    address: school.address ?? "",
    phone: school.phone ?? "",
    email: school.email ?? "",
    motto: school.motto ?? "",
    logoUrl: school.logoUrl ?? "",
    timeZone: school.timeZone ?? "",
    level: schoolLevelFromConfig(school),
  };
}

export function schoolInformationPatch(draft: SchoolInformationDraft, school?: School): Partial<School> {
  const patch: Partial<School> = {
    name: draft.name.trim(),
    address: draft.address.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    motto: draft.motto.trim(),
    logoUrl: draft.logoUrl,
  };
  if (!school || draft.level !== schoolLevelFromConfig(school)) {
    patch.schoolType = draft.level;
    patch.educationLevels = educationLevelsForSchoolLevel(draft.level);
  }
  if (draft.timeZone.trim() !== (school?.timeZone ?? "")) patch.timeZone = draft.timeZone.trim();
  return patch;
}

export function validSchoolTimeZone(value: string): boolean {
  if (!value.trim()) return true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }); return true; }
  catch { return false; }
}

export function canSaveSchoolInformation(input: {
  draft: SchoolInformationDraft;
  confirmation: string;
  saving: boolean;
  logoProcessing: boolean;
  logoValid?: boolean;
}) {
  return Boolean(
    input.draft.name.trim()
      && validSchoolTimeZone(input.draft.timeZone)
      && input.confirmation === SCHOOL_INFORMATION_CONFIRMATION
      && !input.saving
      && !input.logoProcessing
      && input.logoValid !== false,
  );
}
