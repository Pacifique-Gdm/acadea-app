import { describe, expect, it } from "vitest";
import type { AppUser, Message } from "../types";
import { administrativeSenderDetails, formatAdministrativeSender } from "./administrativeSender";

const baseMessage: Message = {
  id: "message-a",
  schoolId: "school-a",
  schoolYearId: "year-a",
  senderId: "secretary-a",
  recipientParentId: "school",
  subject: "Objet",
  body: "Message",
  createdAt: "2026-08-09T10:00:00.000Z",
};

describe("identite des expediteurs administratifs", () => {
  it.each([
    ["school_admin", "Administrateur"],
    ["cashier", "Caissier"],
    ["secretary", "Secrétaire"],
    ["discipline_director", "Directeur de Discipline"],
  ] as const)("affiche le nom et la fonction pour %s", (senderRole, expectedRole) => {
    expect(formatAdministrativeSender({ ...baseMessage, senderName: "Marie Kabeya", senderRole })).toBe(`Marie Kabeya — ${expectedRole}`);
  });

  it("privilegie le snapshot serveur sur l'annuaire client", () => {
    const sender = { id: "secretary-a", name: "Nom actuel", role: "secretary" } as AppUser;
    expect(formatAdministrativeSender({ ...baseMessage, senderName: "Nom historique", senderRole: "secretary" }, sender)).toBe("Nom historique — Secrétaire");
  });

  it("garde les anciens messages lisibles sans utiliser le nom de l'ecole", () => {
    expect(administrativeSenderDetails(baseMessage)).toEqual({ name: "Utilisateur administratif", role: "Administratif" });
  });
});
