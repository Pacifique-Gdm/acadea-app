import { describe, expect, it } from "vitest";
import type { SchoolMessageRecipient } from "../../services/schoolMessaging";
import { administrativeRoleLabel, filterAdministrativeRecipients, resolveAdministrativeRecipientIds, toggleAdministrativeRecipient } from "./administrativeRecipientSelection";

const recipients: SchoolMessageRecipient[] = [
  { uid: "admin", name: "Anne Mbuyi", role: "school_admin" },
  { uid: "cashier", name: "Paul Kanku", role: "cashier" },
  { uid: "secretary", name: "Marie Kabeya", role: "secretary" },
  { uid: "discipline", name: "Jean Mukendi", role: "discipline_director" },
];

describe("selection des destinataires administratifs", () => {
  it("resout Tous les administratifs en un ensemble unique", () => {
    expect(resolveAdministrativeRecipientIds("all", recipients, ["secretary"])).toEqual(["admin", "cashier", "secretary", "discipline"]);
  });

  it("ne retourne aucune liste lorsque la recherche est vide", () => {
    expect(filterAdministrativeRecipients(recipients, "")).toEqual([]);
    expect(filterAdministrativeRecipients(recipients, "   ")).toEqual([]);
  });

  it("recherche par nom ou role sans tenir compte de la casse et des accents", () => {
    expect(filterAdministrativeRecipients(recipients, "marie").map(({ uid }) => uid)).toEqual(["secretary"]);
    expect(filterAdministrativeRecipients(recipients, "KABEYA").map(({ uid }) => uid)).toEqual(["secretary"]);
    expect(filterAdministrativeRecipients(recipients, "secretaire").map(({ uid }) => uid)).toEqual(["secretary"]);
    expect(filterAdministrativeRecipients(recipients, "CAISS").map(({ uid }) => uid)).toEqual(["cashier"]);
    expect(filterAdministrativeRecipients(recipients, "discipline").map(({ uid }) => uid)).toEqual(["discipline"]);
    expect(administrativeRoleLabel("school_admin")).toBe("Administrateur");
  });

  it("conserve plusieurs selections, evite les doublons et permet le retrait individuel", () => {
    const first = toggleAdministrativeRecipient([], "secretary");
    const second = toggleAdministrativeRecipient(first, "cashier");
    expect(second).toEqual(["secretary", "cashier"]);
    expect(resolveAdministrativeRecipientIds("selection", recipients, [...second, "cashier", "forged"])).toEqual(["secretary", "cashier"]);
    expect(toggleAdministrativeRecipient(second, "secretary")).toEqual(["cashier"]);
  });
});
