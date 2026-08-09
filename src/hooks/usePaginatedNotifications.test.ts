import { describe, expect, it } from "vitest";
import type { AppNotification, AppUser } from "../types";
import { mergeRealtimeNotifications } from "./usePaginatedNotifications";

const admin = { id: "admin-a", role: "school_admin", schoolId: "school-a" } as AppUser;

function notification(id: string, recipientUserId: string): AppNotification {
  return { id, schoolId: "school-a", schoolYearId: "year-a", recipientUserId, type: "message", title: "Message", body: "Objet", createdAt: id, read: false };
}

describe("badge personnel de messagerie", () => {
  it("passe de 3 a 2 puis a 0 lorsque les snapshots non lus se vident", () => {
    const three = [notification("3", "admin-a"), notification("2", "admin-a"), notification("1", "admin-a")];
    expect(mergeRealtimeNotifications(admin, [], [three])).toHaveLength(3);
    expect(mergeRealtimeNotifications(admin, [], [three.slice(1)])).toHaveLength(2);
    expect(mergeRealtimeNotifications(admin, [], [[]])).toHaveLength(0);
  });

  it("n'affecte pas le badge d'un autre destinataire", () => {
    const snapshots = [[notification("admin", "admin-a"), notification("cashier", "cashier-a")]];
    expect(mergeRealtimeNotifications(admin, [], snapshots).map((item) => item.id)).toEqual(["admin"]);
    expect(mergeRealtimeNotifications({ ...admin, id: "cashier-a", role: "cashier" }, [], snapshots).map((item) => item.id)).toEqual(["cashier"]);
  });
});
