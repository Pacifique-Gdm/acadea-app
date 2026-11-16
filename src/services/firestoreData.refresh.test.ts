import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const reads = vi.hoisted(() => ({ getDocs: vi.fn(async () => ({ docs: [], metadata: { fromCache: false } })) }));
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
  collection: vi.fn((_db: unknown, path: string) => path),
  query: vi.fn((path: unknown) => path),
  getDocs: reads.getDocs,
}));
import { loadFirestoreData, loadFirestoreYearData } from "./firestoreData";

const user = (role: AppUser["role"]) => ({ id: "user-a", name: "E2E", role, schoolId: "school-a", status: "active" } as AppUser);
describe("périmètre réel du refresh scolaire", () => {
  beforeEach(() => { vi.clearAllMocks(); reads.getDocs.mockReset().mockResolvedValue({ docs: [], metadata: { fromCache: false } }); });
  it.each(["study_director", "teacher"] as const)("délègue %s aux abonnements spécialisés sans lecture scolaire globale", async (role) => {
    expect(await loadFirestoreYearData(user(role), "year-a")).toEqual({});
    expect(reads.getDocs).not.toHaveBeenCalled();
  });
  it("préserve le chemin Administrateur", async () => {
    await loadFirestoreYearData(user("school_admin"), "year-a");
    expect(reads.getDocs).toHaveBeenCalled();
  });
  it("n'annonce pas une actualisation réussie si une lecture serveur est refusée", async () => {
    reads.getDocs.mockRejectedValueOnce({ code: "permission-denied", message: "denied" });
    await expect(loadFirestoreYearData(user("school_admin"), "year-a")).rejects.toMatchObject({ code: "permission-denied", collectionPath: "students" });
  });
  it("ne prend pas un cache local pour une actualisation serveur", async () => {
    reads.getDocs.mockResolvedValueOnce({ docs: [], metadata: { fromCache: true } });
    await expect(loadFirestoreYearData(user("school_admin"), "year-a")).rejects.toMatchObject({ code: "unavailable", collectionPath: "students" });
  });
  it("applique le groupe financier confirmé sans effacer les messages si leur lecture expire", async () => {
    reads.getDocs.mockImplementation(async (path?: unknown) => {
      if (path === "messages") throw { code: "client-timeout" };
      return { docs: [], metadata: { fromCache: false } };
    });
    const report = vi.fn();
    const result = await loadFirestoreYearData(user("school_admin"), "year-a", report);
    expect(result).toHaveProperty("payments", []);
    expect(result).toHaveProperty("expenses", []);
    expect(result).not.toHaveProperty("messages");
    expect(report).toHaveBeenCalledWith("messages", expect.objectContaining({ code: "client-timeout" }));
    report.mockClear();
    reads.getDocs.mockResolvedValue({ docs: [], metadata: { fromCache: false } });
    expect(await loadFirestoreYearData(user("school_admin"), "year-a", report)).toHaveProperty("messages", []);
    expect(report).toHaveBeenCalledWith("messages", null);
  });

  it("ne valide jamais le lot financier si un des paiements vient du cache", async () => {
    reads.getDocs.mockImplementation(async (path?: unknown) => ({
      docs: [], metadata: { fromCache: path === "payments" },
    }));
    await expect(loadFirestoreYearData(user("cashier"), "year-a", vi.fn()))
      .rejects.toMatchObject({ code: "unavailable", collectionPath: "payments" });
  });

  it("préserve le démarrage du portail malgré l'échec de l'historique d'activité ou des messages", async () => {
    reads.getDocs.mockImplementation(async (path?: unknown) => {
      if (path === "auditLogs" || path === "messages") throw { code: "client-timeout" };
      return { docs: [], metadata: { fromCache: false } };
    });
    const report = vi.fn();
    const result = await loadFirestoreData(user("school_admin"), "year-a", {
      users: [], schools: [], schoolYears: [{ id: "year-a", schoolId: "school-a" }] as never,
    }, { omitRealtimeManagedCollections: true, onSecondaryResult: report });
    expect(result).not.toBeNull();
    expect(report).toHaveBeenCalledWith("messages", expect.objectContaining({ code: "client-timeout" }));
    expect(report).toHaveBeenCalledWith("auditLogs", expect.objectContaining({ code: "client-timeout" }));
    expect(report).toHaveBeenCalledWith("attendance", null);
  });

});
