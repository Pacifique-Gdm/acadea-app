import { describe, expect, it, vi } from "vitest";
import { claimOperationalDispatch } from "./operationalNotification.js";

function database(status?: string) {
  const reference = { path: "" };
  const transaction = { get: vi.fn(async () => ({ exists: Boolean(status), data: () => status ? { status, attemptCount: 1 } : undefined })), set: vi.fn() };
  return {
    reference,
    transaction,
    value: {
      doc: vi.fn((path: string) => { reference.path = path; return reference; }),
      runTransaction: vi.fn(async (callback: (input: typeof transaction) => Promise<boolean>) => callback(transaction)),
    },
  };
}

describe("idempotence opérationnelle", () => {
  it("inclut module, événement et notification dans la clé", async () => {
    const db = database();
    await claimOperationalDispatch(db.value as never, "attendance", "student_absent", "notif-a");
    expect(db.reference.path).toBe("pushDispatches/attendance__student_absent__notif-a");
  });

  it("bloque completed et reprend failed", async () => {
    const completed = database("completed");
    await expect(claimOperationalDispatch(completed.value as never, "discipline", "discipline_incident_created", "notif-a")).resolves.toBeNull();
    const failed = database("failed");
    await expect(claimOperationalDispatch(failed.value as never, "announcements", "announcement_published", "notif-a")).resolves.not.toBeNull();
    expect(failed.transaction.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "processing", attemptCount: 2 }), { merge: true });
  });
});
