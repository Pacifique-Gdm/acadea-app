import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("couverture SEC-008 des endpoints sensibles", () => {
  it.each([
    ["finances", "../../api/manage-financial-transaction.js", "finance.${action}"],
    ["provisioning école", "../../api/provision-school-admin.js", "provision.school"],
    ["provisioning comptes", "../../api/provision-school-account.js", "provision.account"],
    ["gestion/suppression école", "../../api/manage-school.js", "school.${action"],
    ["message parent", "../../api/send-parent-message.js", "parent.message.send"],
  ])("protège %s côté API", (_label, path, action) => {
    const source = read(path);
    expect(source).toContain("enforceApiRateLimit");
    expect(source).toContain(action);
  });

  it.each([
    ["Assistant IA", "../../functions/src/ai/writingAssistant.ts", "ai.generate"],
    ["reset et configuration IA", "../../functions/src/ai/schoolAiAdmin.ts", "ai.quota.reset"],
    ["Courriers/Rapports", "../../functions/src/audit/secretaryDocumentDeletion.ts", "secretary.${kind}.${action}"],
  ])("protège %s côté Functions", (_label, path, action) => {
    const source = read(path);
    expect(source).toContain("enforceCallableRateLimit");
    expect(source).toContain(action);
  });
});
