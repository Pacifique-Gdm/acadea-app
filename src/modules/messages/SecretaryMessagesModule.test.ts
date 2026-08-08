import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("interface Message du Secrétaire", () => {
  const source = readFileSync(new URL("./SecretaryMessagesModule.tsx", import.meta.url), "utf8");

  it("retire uniquement le bloc Messages récents", () => {
    expect(source).not.toContain('FormPanel title="Messages récents"');
    expect(source).toContain('FormPanel title="Envoyer un message"');
    expect(source).toContain("sendSchoolMessage");
    expect(source).toContain("uploadPendingMessageAttachments");
  });

  it("présente Parents d'élèves avant Administratifs et conserve la sélection multiple", () => {
    const administrativeOption = source.indexOf('<option value="administrative">Administratifs</option>');
    const parentsOption = source.indexOf('<option value="parents">Parents d\'\u00e9lèves</option>');
    expect(administrativeOption).toBeGreaterThan(-1);
    expect(administrativeOption).toBeGreaterThan(parentsOption);
    expect(source).toContain('type="checkbox"');
    expect(source).toContain("setRecipientIds((current)");
  });
});
