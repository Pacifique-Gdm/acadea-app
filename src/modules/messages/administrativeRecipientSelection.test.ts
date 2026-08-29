import { describe, expect, it } from "vitest";
import type { SchoolMessageRecipient } from "../../services/schoolMessaging";
import { administrativeRoleLabel, filterAdministrativeRecipients, filterRecipientsByDirectoryKind, resolveAdministrativeRecipientIds, toggleAdministrativeRecipient } from "./administrativeRecipientSelection";

const recipients: SchoolMessageRecipient[] = [
  { uid: "admin", name: "Anne Mbuyi", role: "school_admin" },
  { uid: "cashier", name: "Paul Kanku", role: "cashier" },
  { uid: "secretary", name: "Marie Kabeya", role: "secretary" },
  { uid: "discipline", name: "Jean Mukendi", role: "discipline_director" },
  { uid: "study", name: "Aline Études", role: "study_director" },
  { uid: "teacher", name: "Paul Enseignant", role: "teacher" },
  { uid: "coordination", name: "Coordination Centrale", role: "coordination_admin" },
  { uid: "sub-coordination", name: "Sous-coordination Gombe", role: "sub_coordination_admin" },
];

describe("destinataires administratifs", () => {
  it("resout Tous les administratifs en un ensemble unique", () => {
    expect(resolveAdministrativeRecipientIds("all", recipients, ["secretary"])).toEqual(["admin", "cashier", "secretary", "discipline", "study", "teacher", "coordination", "sub-coordination"]);
  });

  it("conserve le helper de recherche vide pour les autres portails", () => {
    expect(filterAdministrativeRecipients(recipients, "")).toEqual([]);
    expect(filterAdministrativeRecipients(recipients, "   ")).toEqual([]);
  });

  it("recherche par nom ou role sans tenir compte de la casse et des accents", () => {
    expect(filterAdministrativeRecipients(recipients, "marie").map(({ uid }) => uid)).toEqual(["secretary"]);
    expect(filterAdministrativeRecipients(recipients, "KABEYA").map(({ uid }) => uid)).toEqual(["secretary"]);
    expect(filterAdministrativeRecipients(recipients, "secretaire").map(({ uid }) => uid)).toEqual(["secretary"]);
    expect(filterAdministrativeRecipients(recipients, "CAISS").map(({ uid }) => uid)).toEqual(["cashier"]);
    expect(filterAdministrativeRecipients(recipients, "discipline").map(({ uid }) => uid)).toEqual(["discipline"]);
    expect(filterAdministrativeRecipients(recipients, "directeur des etudes").map(({ uid }) => uid)).toEqual(["study"]);
    expect(administrativeRoleLabel("school_admin")).toBe("Administrateur");
    expect(administrativeRoleLabel("study_director")).toBe("Directeur des études");
    expect(administrativeRoleLabel("coordination_admin")).toBe("Coordinateur");
    expect(administrativeRoleLabel("sub_coordination_admin")).toBe("Sous-coordinateur");
  });

  it("conserve plusieurs selections, evite les doublons et permet le retrait individuel", () => {
    const first = toggleAdministrativeRecipient([], "secretary");
    const second = toggleAdministrativeRecipient(first, "cashier");
    expect(second).toEqual(["secretary", "cashier"]);
    expect(resolveAdministrativeRecipientIds("selection", recipients, [...second, "cashier", "forged"])).toEqual(["secretary", "cashier"]);
    expect(toggleAdministrativeRecipient(second, "secretary")).toEqual(["cashier"]);
  });

  it("isole les enseignants du répertoire administratif", () => {
    expect(filterRecipientsByDirectoryKind(recipients, "teacher").map(({ uid }) => uid)).toEqual(["teacher"]);
    expect(filterRecipientsByDirectoryKind(recipients, "administrative").map(({ uid }) => uid)).not.toContain("teacher");
  });
});
