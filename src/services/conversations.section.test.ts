import { describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";
vi.mock("../firebase", () => ({ db: null, firebaseReady: false }));
import { markConversationUnreadCountRead, markSingleConversationUnreadCountRead } from "./conversations";
import { conversationReadField } from "../utils/conversationReadField";

describe("compteurs de lecture historiques", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"] as const)("ne réutilise jamais le compteur principal pour %s", async (role) => {
    const actor = { id: "fictitious", role, schoolId: "test" } as AppUser;
    expect(conversationReadField(role)).toBeNull();
    await expect(markConversationUnreadCountRead(actor, "test", "year")).rejects.toThrow("non autorisé");
    await expect(markSingleConversationUnreadCountRead(actor, "conversation")).rejects.toThrow("non autorisé");
  });
  it("préserve les compteurs des rôles historiques", () => {
    expect(conversationReadField("school_admin")).toBe("unreadAdminCount");
    expect(conversationReadField("cashier")).toBe("unreadCashierCount");
    expect(conversationReadField("parent")).toBe("unreadParentCount");
    expect(conversationReadField("discipline_director")).toBe("unreadDisciplineCount");
  });
});
