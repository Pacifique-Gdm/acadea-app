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
    level: schoolLevelFromConfig(school),
  };
}

export function schoolInformationPatch(draft: SchoolInformationDraft): Partial<School> {
  return {
    name: draft.name.trim(),
    address: draft.address.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    motto: draft.motto.trim(),
    logoUrl: draft.logoUrl,
    schoolType: draft.level,
    educationLevels: educationLevelsForSchoolLevel(draft.level),
  };
}

export function canSaveSchoolInformation(input: {
  draft: SchoolInformationDraft;
  confirmation: string;
  saving: boolean;
  logoProcessing: boolean;
}) {
  return Boolean(
    input.draft.name.trim()
      && input.confirmation === SCHOOL_INFORMATION_CONFIRMATION
      && !input.saving
      && !input.logoProcessing,
  );
}
