import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error The Vercel helper is intentionally implemented in JavaScript.
import { listAllowedMessageRecipients } from "../../api/_lib/messageRecipients.js";
// @ts-expect-error The Vercel endpoint is intentionally implemented in JavaScript.
import { resolveParentMessageRecipients } from "../../api/send-parent-message.js";

function database(profiles: Record<string, Record<string, unknown>>) {
  return {
    doc: (path: string) => ({ id: path.split("/").pop() ?? "" }),
    getAll: vi.fn(async (...references: Array<{ id: string }>) => references.map((reference) => ({
      id: reference.id,
      exists: Boolean(profiles[reference.id]),
      data: () => profiles[reference.id],
    }))),
    collection: vi.fn(() => ({
      where: vi.fn((_field: string, _operator: string, schoolId: string) => ({
        get: vi.fn(async () => ({
          docs: Object.entries(profiles)
            .filter(([, profile]) => profile.schoolId === schoolId)
            .map(([id, profile]) => ({ id, data: () => profile })),
        })),
      })),
    })),
  };
}

describe("destinataires dynamiques du Parent", () => {
  const profiles = {
    caller: { name: "Parent", role: "parent", schoolId: "school-a", status: "active" },
    admin: { name: "Admin", role: "admin", schoolId: "school-a", status: "active" },
    secretary: { name: "Secretaire", role: "secretary", schoolId: "school-a", status: "active" },
    cashier: { name: "Caissier", role: "cashier", schoolId: "school-a", status: "active" },
    discipline: { name: "Discipline", role: "discipline_director", schoolId: "school-a", status: "active" },
    parent: { name: "Autre parent", role: "parent", schoolId: "school-a", status: "active" },
    inactive: { name: "Inactif", role: "secretary", schoolId: "school-a", status: "inactive" },
    external: { name: "Externe", role: "school_admin", schoolId: "school-b", status: "active" },
  };

  it("liste uniquement les personnels actifs autorises de la meme ecole", async () => {
    const recipients = await listAllowedMessageRecipients(database(profiles), { uid: "caller", role: "parent", schoolId: "school-a" });
    expect(recipients.map((recipient: { role: string }) => recipient.role).sort()).toEqual(["cashier", "discipline_director", "school_admin", "secretary"]);
    expect(recipients.every((recipient: Record<string, unknown>) => Object.keys(recipient).sort().join(",") === "name,role,uid")).toBe(true);
  });

  it("valide chaque identifiant cote serveur et refuse autre ecole, inactif et role interdit", async () => {
    const db = database(profiles);
    await expect(resolveParentMessageRecipients(db, { schoolId: "school-a" }, ["admin", "secretary"])).resolves.toHaveLength(2);
    await expect(resolveParentMessageRecipients(db, { schoolId: "school-a" }, ["external"])).rejects.toMatchObject({ code: "invalid-recipient" });
    await expect(resolveParentMessageRecipients(db, { schoolId: "school-a" }, ["inactive"])).rejects.toMatchObject({ code: "invalid-recipient" });
    await expect(resolveParentMessageRecipients(db, { schoolId: "school-a" }, ["parent"])).rejects.toMatchObject({ code: "invalid-recipient" });
  });

  it("compte une seule unite de quota quel que soit le nombre de destinataires", () => {
    const source = readFileSync(new URL("../../api/send-parent-message.js", import.meta.url), "utf8");
    expect(source).toContain("const recipients = await resolveParentMessageRecipients(db, caller, recipientIds)");
    expect(source).toContain("messageCount: existingCount + 1");
    expect(source.match(/messageCount: existingCount \+ 1/g)).toHaveLength(2);
    expect(source).not.toMatch(/existingCount\s*\+\s*recipients\.length/);
    expect(source).toContain("notifications = recipients.map");
  });
});
