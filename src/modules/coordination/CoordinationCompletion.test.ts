import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");
const portal = read("src", "modules", "coordination", "CoordinationPortal.tsx");
const messages = read("src", "modules", "coordination", "CoordinationMessage.tsx");
const menu = read("src", "modules", "coordination", "CoordinationMenu.tsx");
const recipientApi = read("api", "coordination-message-recipients.js");
const sendApi = read("api", "send-coordination-message.js");
const yearApi = read("api", "manage-coordination-school-years.js");
const managementApi = read("api", "manage-coordination.js");
const readModel = read("src", "services", "coordinationReadModel.ts");

describe("finalisation du module Coordination", () => {
  it("conserve quatre onglets et raccorde Message et les six Drawers du Menu", () => {
    expect(portal).toContain("<CoordinationMessage");
    expect(portal).toContain("<CoordinationMenu");
    for (const label of ["Types de frais", "Rapport financier", "Personnels", "Année scolaire", "Paramètres coordination", "Historique"]) expect(menu).toContain(label);
  });

  it("propose uniquement les sept catégories de destinataires attendues", () => {
    for (const role of ["school_admin", "discipline_director", "study_director", "cashier", "teacher", "parent", "secretary"]) expect(messages).toContain(`${role}:`);
    expect(messages).toContain("sending ||");
  });

  it("revalide côté serveur l'école, le rôle et chaque destinataire", () => {
    expect(recipientApi).toContain("activeCoordinationSchoolIds");
    expect(recipientApi).toContain("ALLOWED_ROLES");
    expect(sendApi).toContain("school-outside-coordination");
    expect(sendApi).toContain("invalid-recipient");
    expect(sendApi).toContain("coordinationMessageRequests");
    expect(sendApi).toContain("batch.create(requestRef");
  });

  it("gouverne les années globalement, sans écraser une année existante", () => {
    expect(yearApi).toContain('action === "close"');
    expect(yearApi).toContain('action === "open"');
    expect(yearApi).toContain("batch.create(yearRef");
    expect(yearApi).toContain("referenceSchoolYear");
    expect(yearApi).toContain('status: "blocked"');
    expect(yearApi).toContain("activeCoordinationSchoolIds");
    expect(yearApi).not.toContain("input.schoolIds");
  });

  it("synchronise atomiquement le rattachement dénormalisé utilisé par le verrouillage Admin", () => {
    expect(managementApi).toContain("activeCoordinationId: coordinationId");
    expect(managementApi).toContain("activeCoordinationId: null");
    expect(managementApi).toContain("coordination.school.removed");
  });

  it("maintient les vues financières et personnels en lecture seule avec exports", () => {
    expect(menu).toContain("loadCoordinationReadModel");
    for (const kind of ["fees", "finance", "personnel", "years", "history"]) expect(menu).toContain(`exportPdf("${kind}")`);
    expect(portal).toContain("exportDashboardPdf");
    expect(portal).toContain("exportStudentsPdf");
    expect(menu).not.toContain("Créer un paiement");
    expect(menu).not.toContain("Ajouter une dépense");
  });

  it("borne les lectures multi-écoles par lots et pages", () => {
    expect(readModel).toContain("index += 30");
    expect(readModel).toContain("limit(500)");
    expect(readModel).toContain("startAfter(cursor)");
    expect(recipientApi).toContain("limit(500)");
  });
});
