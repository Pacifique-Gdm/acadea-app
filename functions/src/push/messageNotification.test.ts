import { describe, expect, it, vi } from "vitest";
import { claimMessageDispatch } from "./messageNotification.js";

function databaseWith(status?: string, attemptCount = 0) {
  const reference = { path: "", set: vi.fn() };
  const transaction = {
    get: vi.fn(async () => ({ exists: Boolean(status), data: () => status ? { status, attemptCount } : undefined })),
    set: vi.fn(),
  };
  const database = {
    doc: vi.fn((path: string) => {
      reference.path = path;
      return reference;
    }),
    runTransaction: vi.fn(async (callback: (value: typeof transaction) => Promise<boolean>) => callback(transaction)),
  };
  return { database, reference, transaction };
}

describe("idempotence des pushes de messagerie", () => {
  it("distingue l'événement et l'identifiant de notification", async () => {
    const { database, reference } = databaseWith();
    await claimMessageDispatch(database as never, "school_message_received", "notif-a");
    expect(reference.path).toBe("pushDispatches/school_message_received__notif-a");
  });

  it.each(["processing", "completed"])("ne reprend pas un dispatch %s", async (status) => {
    const { database, transaction } = databaseWith(status);
    await expect(claimMessageDispatch(database as never, "parent_message_received", "notif-a")).resolves.toBeNull();
    expect(transaction.set).not.toHaveBeenCalled();
  });

  it("reprend un dispatch échoué au lieu de le considérer terminé", async () => {
    const { database, transaction } = databaseWith("failed", 1);
    await expect(claimMessageDispatch(database as never, "parent_message_received", "notif-a")).resolves.not.toBeNull();
    expect(transaction.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "processing", attemptCount: 2 }), { merge: true });
  });
});
