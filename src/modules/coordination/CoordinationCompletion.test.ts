import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");
const portal = read("src", "modules", "coordination", "CoordinationPortal.tsx");
const messages = read("src", "modules", "coordination", "CoordinationMessage.tsx");
const menu = read("src", "modules", "coordination", "CoordinationMenu.tsx");
const recipientApi = read("api", "coordination-message-recipients.js");
const yearApi = read("api", "manage-coordination-school-years.js");
const managementApi = read("api", "manage-coordination.js");
const readModel = read("src", "services", "coordinationReadModel.ts");
const subManagement = read("src", "modules", "coordination", "SubCoordinationManagement.tsx");
const auth = read("src", "services", "auth.ts");
const rules = read("firestore.rules");

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
    expect(recipientApi).toContain("resolveCoordinationSchoolScope");
    expect(recipientApi).toContain("ALLOWED_ROLES");
    expect(recipientApi).toContain("school-outside-coordination");
    expect(recipientApi).toContain("invalid-recipient");
    expect(recipientApi).toContain("coordinationMessageRequests");
    expect(recipientApi).toContain("batch.create(requestRef");
    expect(recipientApi).toContain('return await (req.method === "GET"');
  });

  it("reste compatible avec la limite Vercel Hobby de douze fonctions", () => {
    const functions = readdirSync(join(process.cwd(), "api"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"));
    expect(functions).toHaveLength(12);
  });

  it("gouverne les années globalement, sans écraser une année existante", () => {
    expect(yearApi).toContain('action === "close"');
    expect(yearApi).toContain('action === "open"');
    expect(yearApi).toContain("batch.create(yearRef");
    expect(yearApi).toContain("referenceSchoolYear");
    expect(yearApi).toContain('status: "blocked"');
    expect(yearApi).toContain("resolveCoordinationSchoolScope");
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
    expect(menu).toContain('aria-label="Filtrer par rôle"');
    expect(menu).toContain('aria-label="Filtrer par statut"');
    expect(menu).toContain("principalCoordinatorName");
  });

  it("expose la création dans l'historique et dérive une année de référence initiale", () => {
    expect(managementApi).toContain("coordinationId: coordinationRef.id");
    expect(managementApi).toContain('action: "Création Coordination"');
    expect(yearApi).toContain("configuredReferenceYear || rows.find");
    expect(menu).toContain("item.coordinationId === coordination.id");
    expect(readModel).not.toContain("!coordinationId || schoolIds.length === 0");
  });

  it("borne les lectures multi-écoles par lots et pages", () => {
    expect(readModel).toContain("index += 30");
    expect(readModel).toContain("limit(500)");
    expect(readModel).toContain("startAfter(cursor)");
    expect(recipientApi).toContain("limit(500)");
  });

  it("partage le portail avec le Sous-coordinateur sans cinquième onglet", () => {
    expect(portal).toContain('"sub_coordination_admin"');
    expect(auth).toContain('role === "sub_coordination_admin"');
    expect(portal.match(/\["(dashboard|students|messages|menu)"/g)).toHaveLength(4);
    expect(menu).toContain('user.role === "coordination_admin" ? [["subCoordinations"');
  });

  it("réutilise les champs et helpers Acadéa pour créer une Sous-coordination", () => {
    for (const label of ["Nom", "Postnom", "Prénom", "Téléphone", "Email", "Mot de passe temporaire", "Circonscription", "Écoles à superviser"]) expect(subManagement).toContain(label);
    expect(subManagement).toContain("temporaryPasswordAfterPhoneChange");
    expect(subManagement).toContain("MultiSelectDropdown");
    expect(subManagement).toContain("schoolIds.length");
  });

  it("centralise le périmètre serveur et garde l’année en lecture seule", () => {
    expect(recipientApi).toContain("resolveCoordinationSchoolScope");
    expect(yearApi).toContain("requireActiveCoordinationActor");
    expect(yearApi).toContain('caller.role !== "coordination_admin"');
    expect(menu).toContain("Consultation uniquement");
    expect(rules).toContain("function subCoordinator()");
    expect(rules).toContain("subCoordinationSchools");
  });

  it("alimente le Dashboard, les élèves, la messagerie et les PDF depuis le même périmètre délégué", () => {
    expect(portal).toContain('relationCollection = user.role === "sub_coordination_admin" ? "subCoordinationSchools" : "coordinationSchools"');
    expect(portal).toContain("const activeSchools = useMemo");
    expect(portal).toContain("const scopedSchools = useMemo");
    expect(portal).toContain('value: String(scopedSchools.length)');
    expect(portal).toContain("], visibleStudents");
    expect(portal).toContain("<CoordinationMessage schools={activeSchools}");
    expect(portal).toContain("<CoordinationMenu");
  });

  it("gère création, périmètre, transfert et cycle de vie via l’API existante", () => {
    for (const action of ["create-sub-coordination", "add-sub-school", "remove-sub-school", "transfer-sub-school", "archive-sub-coordination", "reactivate-sub-coordination"]) expect(managementApi).toContain(action);
    expect(managementApi).toContain('role: "sub_coordination_admin"');
    expect(managementApi).toContain("subCoordinationId");
    expect(managementApi).toContain("transaction.update(existing.ref, { active: false");
    expect(managementApi).toContain("auth.deleteUser(authUser.uid)");
  });
});
