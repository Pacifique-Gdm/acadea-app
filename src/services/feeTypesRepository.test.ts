import { beforeEach, describe, expect, it, vi } from "vitest";
import { canDeleteFeeType, deleteFeeType } from "./feeTypesRepository";
import type { AppUser, FeeType } from "../types";

const firestoreMocks = vi.hoisted(() => ({
  batch: { delete: vi.fn(), set: vi.fn(), commit: vi.fn() },
  doc: vi.fn((_database, collectionName, id) => ({ collectionName, id })),
}));
vi.mock("firebase/firestore", () => ({
  doc: firestoreMocks.doc,
  writeBatch: vi.fn(() => firestoreMocks.batch),
}));
vi.mock("../firebase", () => ({ db: { project: "staging" } }));

const fee: FeeType = { id: "fee-a", schoolId: "school-a", schoolYearId: "year-a", name: "Minerval", amount: 100 };
const admin = { id: "admin-a", role: "school_admin", schoolId: "school-a", status: "active" } as AppUser;
const auditLog = { id: "audit-a", schoolId: "school-a", schoolYearId: "year-a" } as Parameters<typeof deleteFeeType>[2];

describe("suppression persistante d'un type de frais", () => {
  beforeEach(() => vi.clearAllMocks());

  it("autorise uniquement l'administrateur actif de la même école", () => {
    expect(canDeleteFeeType(admin, fee)).toBe(true);
    expect(canDeleteFeeType({ ...admin, schoolId: "school-b" }, fee)).toBe(false);
    expect(canDeleteFeeType({ ...admin, status: "inactive" }, fee)).toBe(false);
    expect(canDeleteFeeType({ ...admin, role: "cashier" }, fee)).toBe(false);
  });

  it("supprime réellement le document feeTypes ciblé", async () => {
    await deleteFeeType(admin, fee, auditLog);
    expect(firestoreMocks.doc).toHaveBeenCalledWith(expect.anything(), "feeTypes", "fee-a");
    expect(firestoreMocks.batch.delete).toHaveBeenCalledWith({ collectionName: "feeTypes", id: "fee-a" });
    expect(firestoreMocks.batch.set).toHaveBeenCalledWith({ collectionName: "auditLogs", id: "audit-a" }, auditLog);
    expect(firestoreMocks.batch.commit).toHaveBeenCalledOnce();
  });

  it("n'écrit rien pour une autre école", async () => {
    await expect(deleteFeeType({ ...admin, schoolId: "school-b" }, fee, auditLog)).rejects.toThrow("non autorisée");
    expect(firestoreMocks.batch.delete).not.toHaveBeenCalled();
  });
});
