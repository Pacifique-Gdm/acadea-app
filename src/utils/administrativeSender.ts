import type { AppUser, Message } from "../types";

const administrativeRoleLabels: Partial<Record<AppUser["role"], string>> = {
  school_admin: "Administrateur",
  cashier: "Caissier",
  secretary: "Secrétaire",
  discipline_director: "Directeur de Discipline",
  study_director: "Directeur des études",
  teacher: "Enseignant",
  coordination_admin: "Coordinateur",
  sub_coordination_admin: "Sous-coordinateur",
  super_admin: "Équipe ACADÉA",
};

export function administrativeSenderDetails(message: Message, sender?: AppUser) {
  const role = message.senderRole ?? sender?.role;
  // Lot 25 : le Super administrateur apparaît comme « Équipe ACADÉA », sans rôle répété.
  if (role === "super_admin") return { name: "Équipe ACADÉA", role: "" };
  return {
    name: message.senderName?.trim() || sender?.name?.trim() || "Utilisateur administratif",
    role: role ? administrativeRoleLabels[role] ?? "Administratif" : "Administratif",
  };
}

export function formatAdministrativeSender(message: Message, sender?: AppUser) {
  const details = administrativeSenderDetails(message, sender);
  return details.role ? `${details.name} — ${details.role}` : details.name;
}

/** Lot 25 : « À : … » d'un message envoyé (libellé enregistré, sinon noms connus). */
export function sentMessageRecipientLabel(message: Message, users: Array<Pick<AppUser, "id" | "name" | "role">>) {
  if (message.recipientLabel?.trim()) return message.recipientLabel.trim();
  const ids = message.recipientIds ?? [];
  const known = ids.map((id) => users.find((user) => user.id === id)).filter((user): user is Pick<AppUser, "id" | "name" | "role"> => Boolean(user));
  if (known.length && known.length === ids.length && known.length <= 3) {
    return known.map((user) => user.role === "super_admin" ? "Équipe ACADÉA" : `${user.name} (${administrativeRoleLabels[user.role] ?? (user.role === "parent" ? "Parent" : "Personnel")})`).join(", ");
  }
  return ids.length > 1 ? `${ids.length} destinataires` : ids.length === 1 ? "1 destinataire" : "";
}
