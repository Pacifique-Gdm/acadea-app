import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/parent/ParentPortal.tsx", "utf8");
const selectorSource = readFileSync("src/modules/messages/AdministrativeRecipientSelector.tsx", "utf8");

describe("portail Parent", () => {
  it("ouvre directement l'historique enfant et conserve un retour accessible a droite", () => {
    expect(source).toContain("setSelectedParentChildId(student.id)");
    expect(source).toContain('aria-label="Retour aux enfants"');
    expect(source).toContain("justify-between");
  });

  it("utilise un annuaire dynamique multiselection sans destinataires statiques", () => {
    expect(source).toContain("loadSchoolMessageRecipients()");
    expect(source).toContain("AdministrativeRecipientSelector");
    expect(selectorSource).toContain('type="checkbox"');
    expect(source).toContain("messageRecipientIds");
    expect(source).not.toContain('<option value="admin">');
  });

  it("partage exactement les modes administratifs du Secrétaire sans afficher la liste à vide", () => {
    expect(selectorSource).toContain('<option value="all">Tous les administratifs</option>');
    expect(selectorSource).toContain('<option value="selection">Sélection administratif</option>');
    expect(selectorSource).toContain("Recherchez un administratif par nom ou fonction.");
    expect(selectorSource).toContain("search.trim()");
    expect(source).toContain('useState<AdministrativeRecipientMode>("all")');
    expect(source).toContain("resolveAdministrativeRecipientIds(messageRecipientMode, messageRecipients, messageRecipientIds)");
  });

  it("envoie une seule requête sécurisée avec les destinataires résolus et sans pièces jointes", () => {
    expect(source).toContain("recipientIds: resolvedMessageRecipientIds");
    expect(source).toContain("sendParentMessageWithQuota");
    expect(source).not.toContain("uploadPendingMessageAttachments");
    expect(source).not.toContain("canAttachFiles");
  });

  it("expose les fiches medicales en consultation et retire le bloc Notifications Acadea du compte", () => {
    expect(source).toContain('title="Fiche m');
    expect(source).toContain("medicalRecordSections.map");
    expect(source).toContain("subscribeToParentMedicalRecords");
    expect(source).not.toMatch(/title="Notifications Acad/);
  });

  it("place le retour avant le titre de l'historique des paiements", () => {
    const returnButton = source.indexOf('aria-label="Retour aux enfants"');
    const historyTitle = source.indexOf(">Historique des paiements</h2>");
    expect(returnButton).toBeGreaterThan(-1);
    expect(historyTitle).toBeGreaterThan(returnButton);
    expect(source).toContain("setSelectedParentChildId(null)");
    expect(source).toContain('className="mb-4 flex min-w-0 items-center gap-3"');
  });

  it("borne les fiches médicales et transforme les erreurs Firestore", () => {
    expect(source).toContain("subscribeToParentMedicalRecords");
    expect(source).toContain("medicalRecordReadErrorMessage(error)");
    expect(source).not.toContain('setParentMedicalError(error.message');
  });
});
