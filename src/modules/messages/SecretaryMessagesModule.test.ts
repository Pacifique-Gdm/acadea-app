import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("interface Message du Secrétaire", () => {
  const source = readFileSync(new URL("./MessagesModule.tsx", import.meta.url), "utf8");
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
    expect(source).toContain('type="checkbox"');
    expect(source).toContain("setSelectedAdministrativeIds((current)");
  });

  it("réserve les pièces jointes au module Secrétaire", () => {
    expect(source).toContain("canAttachFiles = false");
    expect(source).toContain("{canAttachFiles && <>");
    expect(appSource.match(/canAttachFiles/g)).toHaveLength(1);
  });
});
