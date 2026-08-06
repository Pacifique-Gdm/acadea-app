import type { AppUser, ParentProfile, School } from "../types";
import { normalizeEmailDomainLabel } from "./schoolAccountCredentials";

export function parentEmailDomain(school: School) {
  const cleanedName = normalizeEmailDomainLabel(
    school.name.replace(/^(c\.?\s*s\.?|ecole|institut|complexe\s+scolaire|groupe\s+scolaire|college|lycee)\s+/i, ""),
  );
  return `${cleanedName || "acadea"}.com`;
}

export function parentEmailExists(email: string, users: AppUser[], parents: ParentProfile[]) {
  const normalizedEmail = email.trim().toLowerCase();
  return [...users, ...parents].some((item) => item.email.toLowerCase() === normalizedEmail);
}

export function nextParentEmail(school: School, users: AppUser[], parents: ParentProfile[]) {
  const domain = parentEmailDomain(school);
  const usedNumbers = new Set<number>();
  [...users, ...parents].forEach((item) => {
    if (item.schoolId !== school.id) return;
    const match = item.email.toLowerCase().match(new RegExp(`^parent(\\d{4})@${domain.replace(/\./g, "\\.")}$`));
    if (match) usedNumbers.add(Number(match[1]));
  });
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber) || parentEmailExists(`parent${String(nextNumber).padStart(4, "0")}@${domain}`, users, parents)) {
    nextNumber += 1;
  }
  return `parent${String(nextNumber).padStart(4, "0")}@${domain}`;
}

export function emptyParent(schoolId: string, schoolYearId: string): ParentProfile {
  return {
    id: `new-${crypto.randomUUID()}`,
    schoolId,
    schoolYearId,
    userId: "",
    fullName: "",
    phone: "",
    email: "",
    address: "",
    studentIds: [],
    status: "active",
  };
}
