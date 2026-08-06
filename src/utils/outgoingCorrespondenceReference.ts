import type { AppUser } from "../types";

const insignificantWords = new Set(["a", "au", "aux", "de", "des", "du", "et", "l", "la", "le", "les", "d"]);

export function schoolInitials(schoolName: string) {
  const words = schoolName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const significant = words.filter((word) => !insignificantWords.has(word.toLowerCase()));
  return (significant.length ? significant : words).map((word) => word[0]).join("").toUpperCase() || "ECOLE";
}

export function correspondenceServiceCode(service: string | undefined, role: AppUser["role"]) {
  const normalized = service?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (normalized?.includes("direction")) return "DIR";
  if (normalized?.includes("discipline")) return "DISC";
  if (normalized?.includes("administration")) return "ADM";
  if (normalized?.includes("secret")) return "SEC";
  return role === "discipline_director" ? "DISC" : role === "school_admin" ? "DIR" : "SEC";
}

export function generateOutgoingCorrespondenceReference(params: { schoolName: string; serviceCode: string; order: number; year: number }) {
  return `${schoolInitials(params.schoolName)} / ${params.serviceCode} / ${String(params.order).padStart(3, "0")} / ${params.year}`;
}
