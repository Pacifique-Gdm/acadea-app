import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The Vercel helper is intentionally implemented in JavaScript.
import { listAllowedMessageRecipients } from "../../api/_lib/messageRecipients.js";
// @ts-expect-error The Vercel endpoint is intentionally implemented in JavaScript.
import { resolveRecipients } from "../../api/send-school-message.js";

const profiles = {
  admin: { name: "Admin A", role: "school_admin", schoolId: "school-a", status: "active" },
  cashier: { name: "Caissier A", role: "cashier", schoolId: "school-a", status: "active" },
  secretary1: { name: "Secretaire A1", role: "secretary", schoolId: "school-a", status: "active" },
  secretary2: { name: "Secretaire A2", role: "secretary", schoolId: "school-a", status: "active" },
  discipline: { name: "Discipline A", role: "discipline_director", schoolId: "school-a", status: "active" },
  inactive: { name: "Inactif", role: "secretary", schoolId: "school-a", status: "inactive" },
  external: { name: "Admin B", role: "school_admin", schoolId: "school-b", status: "active" },
};

function database() {
  return {
    doc: (path: string) => ({
      id: path.split("/").pop() ?? "",
      get: vi.fn(async () => ({ exists: false, data: () => undefined })),
    }),
    getAll: vi.fn(async (...references: Array<{ id: string }>) => references.map((reference) => ({
      id: reference.id,
      exists: Boolean(profiles[reference.id as keyof typeof profiles]),
      data: () => profiles[reference.id as keyof typeof profiles],
    }))),
    collection: vi.fn(() => ({
      where: vi.fn((_field: string, _operator: string, schoolId: string) => ({
        get: vi.fn(async () => ({
          docs: Object.entries(profiles).filter(([, profile]) => profile.schoolId === schoolId).map(([id, profile]) => ({ id, data: () => profile })),
        })),
      })),
    })),
  };
}

describe("annuaire des administratifs", () => {
  it.each([
    ["admin", "school_admin", ["cashier", "discipline", "secretary1", "secretary2"]],
    ["cashier", "cashier", ["admin", "discipline", "secretary1", "secretary2"]],
    ["discipline", "discipline_director", ["admin", "cashier", "secretary1", "secretary2"]],
  ])("retourne a %s les autres administratifs actifs de son ecole", async (uid, role, expected) => {
    const recipients = await listAllowedMessageRecipients(database(), { uid, role, schoolId: "school-a" });
    expect(recipients.filter((item: { role: string }) => item.role !== "parent").map((item: { uid: string }) => item.uid).sort()).toEqual(expected);
    expect(recipients.map((item: { uid: string }) => item.uid)).not.toContain(uid);
    expect(recipients.map((item: { uid: string }) => item.uid)).not.toContain("external");
    expect(recipients.map((item: { uid: string }) => item.uid)).not.toContain("inactive");
    expect(recipients.every((item: Record<string, unknown>) => Object.keys(item).sort().join(",") === "name,role,uid")).toBe(true);
  });

  it("accepte plusieurs destinataires valides et refuse un identifiant falsifie", async () => {
    const db = database();
    await expect(resolveRecipients(db, { role: "school_admin", schoolId: "school-a" }, ["cashier", "secretary"], ["cashier", "secretary1"], "year-a")).resolves.toHaveLength(2);
    await expect(resolveRecipients(db, { role: "school_admin", schoolId: "school-a" }, ["school_admin"], ["external"], "year-a")).rejects.toMatchObject({ code: "invalid-recipient" });
  });
});
