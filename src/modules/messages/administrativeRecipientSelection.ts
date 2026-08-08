import type { SchoolMessageRecipient } from "../../services/schoolMessaging";

const administrativeRoleLabels: Record<Exclude<SchoolMessageRecipient["role"], "parent">, string> = {
  school_admin: "Administrateur",
  cashier: "Caissier",
  secretary: "Secrétaire",
  discipline_director: "Directeur de Discipline",
};

export type AdministrativeRecipientMode = "all" | "selection";

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
