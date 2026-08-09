import type { AppUser, ParentProfile, School } from "../types";

export type SchoolStaffRole = "cashier" | "secretary" | "discipline_director" | "study_director";

export const schoolStaffEmailPrefixes: Record<SchoolStaffRole, string> = {
  cashier: "caissier",
  secretary: "secretaire",
  discipline_director: "discipline",
  study_director: "etudes",
};

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

export function schoolAccountEmailExists(email: string, users: AppUser[], parents: ParentProfile[]) {
  const normalizedEmail = email.trim().toLowerCase();
  return [...users, ...parents].some((item) => item.email.trim().toLowerCase() === normalizedEmail);
}

export function nextSchoolStaffEmail(school: School, role: SchoolStaffRole, users: AppUser[], parents: ParentProfile[]) {
  const prefix = schoolStaffEmailPrefixes[role];
  const domain = normalizeSchoolEmailDomain(school.name);
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
