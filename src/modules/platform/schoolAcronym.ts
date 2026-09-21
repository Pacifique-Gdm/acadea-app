import { normalizeEmailDomainLabel } from "../../utils/schoolAccountCredentials";

export const SCHOOL_ACRONYM_CONFIRMATION = "MODIFIER LE SIGLE";

export function schoolAcronymError(value: string) {
  const label = normalizeEmailDomainLabel(value.trim());
  return value.length <= 100 && label && label.length <= 63 ? "" : "Le sigle doit produire un domaine email valide (1 à 63 caractères).";
}

export function canSaveSchoolAcronym(value: string, original: string, confirmation: string, saving: boolean) {
  return !saving && value.trim() !== original && !schoolAcronymError(value) && confirmation === SCHOOL_ACRONYM_CONFIRMATION;
}
