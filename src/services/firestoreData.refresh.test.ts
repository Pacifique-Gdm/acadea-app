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
import { loadFirestoreYearData } from "./firestoreData";

const user = (role: AppUser["role"]) => ({ id: "user-a", name: "E2E", role, schoolId: "school-a", status: "active" } as AppUser);
describe("périmètre réel du refresh scolaire", () => {
  beforeEach(() => vi.clearAllMocks());
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
});
