import type { AppUser, Message } from "../types";

const administrativeRoleLabels: Partial<Record<AppUser["role"], string>> = {
  school_admin: "Administrateur",
  cashier: "Caissier",
  secretary: "Secrétaire",
  discipline_director: "Directeur de Discipline",
  study_director: "Directeur des études",
  teacher: "Enseignant",
};

export function administrativeSenderDetails(message: Message, sender?: AppUser) {
  const role = message.senderRole ?? sender?.role;
  return {
    name: message.senderName?.trim() || sender?.name?.trim() || "Utilisateur administratif",
    role: role ? administrativeRoleLabels[role] ?? "Administratif" : "Administratif",
  };
}

export function formatAdministrativeSender(message: Message, sender?: AppUser) {
  const details = administrativeSenderDetails(message, sender);
  return `${details.name} — ${details.role}`;
}
