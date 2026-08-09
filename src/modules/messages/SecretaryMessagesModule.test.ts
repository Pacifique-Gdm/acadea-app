import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("interface Message du Secrétaire", () => {
  const source = readFileSync(new URL("./MessagesModule.tsx", import.meta.url), "utf8");
  const selectorSource = readFileSync(new URL("./AdministrativeRecipientSelector.tsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

  it("utilise le formulaire partagé sans bloc Messages récents", () => {
    expect(source).not.toContain('FormPanel title="Messages récents"');
    expect(source).toContain('FormPanel title="Envoyer un message"');
    expect(source).toContain("sendSchoolMessage");
    expect(source).toContain("uploadPendingMessageAttachments");
    expect(appSource).not.toContain("SecretaryMessagesModule");
    expect(appSource).toMatch(/renderMessages=\{\(\) => \([\s\S]*?<MessagesModule[\s\S]*?canAttachFiles/);
  });

  it("présente Parents d'élèves avant Administratifs et conserve la sélection multiple", () => {
    const administrativeOption = source.indexOf('<option value="administrative">Administratifs</option>');
    const parentsOption = source.indexOf('<option value="parents">Parents d\'élèves</option>');
    expect(administrativeOption).toBeGreaterThan(-1);
    expect(administrativeOption).toBeGreaterThan(parentsOption);
    expect(selectorSource).toContain('type="checkbox"');
    expect(source).toContain("onSelectedIdsChange={setSelectedAdministrativeIds}");
  });

  it("partage avec l'Administrateur le second filtre Parents et tous ses modes", () => {
    expect(source).toContain("isSchoolAdmin || isSecretary ? (");
    [
      '<option value="all">Tous les parents</option>',
      '<option value="parents">Sélection parent</option>',
      '<option value="sections">Sections</option>',
      '<option value="classes">Classes</option>',
    ].forEach((option) => expect(source.split(option)).toHaveLength(2));
    expect(source).toContain('placeholder="Rechercher parent, téléphone ou email"');
    expect(source).toContain("removeAdminParent(parent.id)");
  });

  it("réinitialise les modes incompatibles et conserve la résolution serveur sécurisée", () => {
    expect(source).toContain('changeAdminRecipientMode("all")');
    expect(source).toContain("setSelectedAdministrativeIds([])");
    expect(source).toContain("secureParentRecipientIds");
    expect(source).toContain("resolvedSecretaryParentIds");
    expect(source).toContain("sendToSecureRecipients");
  });

  it("réserve les pièces jointes au module Secrétaire", () => {
    expect(source).toContain("canAttachFiles = false");
    expect(source).toContain("{canAttachFiles && <>");
    expect(appSource.match(/canAttachFiles/g)).toHaveLength(1);
  });
});
