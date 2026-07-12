import type { Message } from "../types";

export function formatSchoolRecipientLabel(schoolRecipient?: Message["schoolRecipient"]) {
  if (schoolRecipient === "admin") return "Administrateur uniquement";
  if (schoolRecipient === "cashier") return "Caissier uniquement";
  if (schoolRecipient === "discipline") return "Discipline uniquement";
  if (schoolRecipient === "both") return "Administrateur et Caissier";
  return "École";
}
