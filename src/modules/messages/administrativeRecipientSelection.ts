import type { SchoolMessageRecipient } from "../../services/schoolMessaging";

const administrativeRoleLabels: Record<Exclude<SchoolMessageRecipient["role"], "parent">, string> = {
  school_admin: "Administrateur",
  cashier: "Caissier",
  secretary: "Secrétaire",
  discipline_director: "Directeur de Discipline",
  study_director: "Directeur des études",
  teacher: "Enseignant",
  coordination_admin: "Coordinateur",
  sub_coordination_admin: "Sous-coordinateur",
};

export type AdministrativeRecipientMode = "all" | "selection";

export type SchoolMessageRecipientCategory = "parents" | "administrative" | "teachers" | "coordination" | "subCoordination";

const baseSchoolMessageRecipientCategories: Array<{ value: SchoolMessageRecipientCategory; label: string }> = [
  { value: "parents", label: "Parents d'élèves" },
  { value: "administrative", label: "Administratifs" },
  { value: "teachers", label: "Enseignants" },
];

export function schoolMessageRecipientCategories(recipients: SchoolMessageRecipient[], includeCoordinationCategories: boolean) {
  const categories = [...baseSchoolMessageRecipientCategories];
  if (!includeCoordinationCategories) return categories;
  if (recipients.some(({ role }) => role === "coordination_admin")) categories.push({ value: "coordination", label: "Coordinateur" });
  if (recipients.some(({ role }) => role === "sub_coordination_admin")) categories.push({ value: "subCoordination", label: "Sous-coordinateur" });
  return categories;
}

export function schoolMessageRecipientsForCategory(
  recipients: SchoolMessageRecipient[],
  category: SchoolMessageRecipientCategory,
  separateCoordinationCategories: boolean,
) {
  if (category === "teachers") return recipients.filter(({ role }) => role === "teacher");
  if (category === "coordination") return recipients.filter(({ role }) => role === "coordination_admin");
  if (category === "subCoordination") return recipients.filter(({ role }) => role === "sub_coordination_admin");
  if (category !== "administrative") return recipients.filter(({ role }) => role === "parent");
  return recipients.filter(({ role }) => role !== "parent" && role !== "teacher"
    && (!separateCoordinationCategories || (role !== "coordination_admin" && role !== "sub_coordination_admin")));
}

export function administrativeRoleLabel(role: SchoolMessageRecipient["role"]) {
  return role === "parent" ? "Parent" : administrativeRoleLabels[role];
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();
}

export function filterAdministrativeRecipients(recipients: SchoolMessageRecipient[], search: string) {
  const normalizedSearch = normalizeSearch(search);
  if (!normalizedSearch) return [];
  return recipients.filter((recipient) => normalizeSearch(`${recipient.name} ${administrativeRoleLabel(recipient.role)}`).includes(normalizedSearch));
}

export function toggleAdministrativeRecipient(ids: string[], uid: string) {
  return ids.includes(uid) ? ids.filter((id) => id !== uid) : [...new Set([...ids, uid])];
}

export function resolveAdministrativeRecipientIds(mode: AdministrativeRecipientMode, recipients: SchoolMessageRecipient[], selectedIds: string[]) {
  const availableIds = new Set(recipients.map((recipient) => recipient.uid));
  return mode === "all"
    ? [...availableIds]
    : [...new Set(selectedIds)].filter((uid) => availableIds.has(uid));
}

export type RecipientDirectoryKind = "administrative" | "teacher" | "coordination" | "subCoordination";

export function recipientDirectoryLabel(kind: RecipientDirectoryKind) {
  if (kind === "teacher") return "enseignant";
  if (kind === "coordination") return "coordinateur";
  if (kind === "subCoordination") return "sous-coordinateur";
  return "administratif";
}

export function filterRecipientsByDirectoryKind(recipients: SchoolMessageRecipient[], kind: RecipientDirectoryKind) {
  if (kind === "teacher") return recipients.filter(({ role }) => role === "teacher");
  if (kind === "coordination") return recipients.filter(({ role }) => role === "coordination_admin");
  if (kind === "subCoordination") return recipients.filter(({ role }) => role === "sub_coordination_admin");
  return recipients.filter(({ role }) => role !== "parent" && role !== "teacher");
}
