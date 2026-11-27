import type { AppUser, ParentProfile, School } from "../types";

export type SchoolStaffRole = "cashier" | "secretary" | "discipline_director" | "study_director" | "teacher";

export const schoolStaffEmailPrefixes: Record<SchoolStaffRole, string> = {
  cashier: "caissier",
  secretary: "secretaire",
  discipline_director: "discipline",
  study_director: "etudes",
  teacher: "enseignant",
};

// Lots 10 et 11 : préfixes des comptes conseillers (liste ci-dessus inchangée).
const advisorEmailPrefixes: Record<string, string> = { pedagogical_advisor: "pedagogie", orientation_advisor: "orientation" };

export function normalizeEmailDomainLabel(schoolName: string) {
  return schoolName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function normalizeSchoolEmailDomain(schoolName: string) {
  const normalizedName = normalizeEmailDomainLabel(schoolName);
  return `${normalizedName || "acadea"}.com`;
}

export function schoolAccountEmailDomain(school: School, legacyName = school.name) {
  return normalizeSchoolEmailDomain(school.acronym?.trim() || legacyName);
}

export function schoolAccountEmailExists(email: string, users: AppUser[], parents: ParentProfile[]) {
  const normalizedEmail = email.trim().toLowerCase();
  // Un parent ou un compte peut ne pas avoir d'e-mail : il ne doit pas faire planter le Menu.
  return [...users, ...parents].some((item) => (item.email ?? "").trim().toLowerCase() === normalizedEmail);
}

export function nextSchoolStaffEmail(school: School, role: SchoolStaffRole | "pedagogical_advisor" | "orientation_advisor", users: AppUser[], parents: ParentProfile[]) {
  const prefix = advisorEmailPrefixes[role] ?? schoolStaffEmailPrefixes[role as SchoolStaffRole];
  const domain = schoolAccountEmailDomain(school);
  let number = 1;
  while (schoolAccountEmailExists(`${prefix}${String(number).padStart(3, "0")}@${domain}`, users, parents)) number += 1;
  return `${prefix}${String(number).padStart(3, "0")}@${domain}`;
}

export function normalizeProvisioningPhone(phone: string) {
  return phone.trim();
}

export function isValidProvisioningPhone(phone: string) {
  const normalized = normalizeProvisioningPhone(phone);
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 6 && /^\+?[0-9][0-9 ()-]*$/.test(normalized);
}
