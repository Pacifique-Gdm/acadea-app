import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const reads = vi.hoisted(() => ({ getDocs: vi.fn(async (...args: unknown[]) => { void args; return { docs: [], metadata: { fromCache: false } }; }) }));
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...await importOriginal<typeof import("firebase/firestore")>(),
  collection: vi.fn((_db: unknown, path: string) => path),
  query: vi.fn((path: unknown) => path),
  getDocs: reads.getDocs,
}));
import { loadFirestoreData, loadFirestoreYearData, startSchoolRefresh } from "./firestoreData";

const user = (role: AppUser["role"]) => ({ id: "user-a", name: "E2E", role, schoolId: "school-a", status: "active" } as AppUser);
describe("périmètre réel du refresh scolaire", () => {
  beforeEach(() => { vi.clearAllMocks(); reads.getDocs.mockReset().mockResolvedValue({ docs: [], metadata: { fromCache: false } }); });
  afterEach(() => vi.useRealTimers());

  it("confirme les finances sans attendre les messages puis applique leur réponse tardive sans relancer de requête", async () => {
    vi.useFakeTimers();
    const deferred: Array<(value: { docs: never[]; metadata: { fromCache: boolean } }) => void> = [];
    reads.getDocs.mockImplementation((path?: unknown) => path === "messages"
      ? new Promise(resolve => deferred.push(resolve))
      : Promise.resolve({ docs: [], metadata: { fromCache: false } }));
    const report = vi.fn();
    const task = startSchoolRefresh(user("school_admin"), "year-a", report);
    await vi.advanceTimersByTimeAsync(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ section: "financial", data: expect.objectContaining({ payments: [] }) }));
    expect(report).not.toHaveBeenCalledWith(expect.objectContaining({ section: "messages" }));
    await vi.advanceTimersByTimeAsync(15000);
    await task.done;
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ section: "messages", error: expect.objectContaining({ code: "client-timeout", collectionPath: "messages" }) }));
    const readsBefore = reads.getDocs.mock.calls.length;
    deferred.forEach(resolve => resolve({ docs: [], metadata: { fromCache: false } }));
    await vi.advanceTimersByTimeAsync(1);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ section: "messages", data: { messages: [] } }));
    expect(reads.getDocs).toHaveBeenCalledTimes(readsBefore);
    task.stop();
  });

  it("rétablit les finances uniquement après la réponse serveur tardive de la collection qui manquait", async () => {
    vi.useFakeTimers();
    let resolveFees!: (value: { docs: never[]; metadata: { fromCache: boolean } }) => void;
    reads.getDocs.mockImplementation((path?: unknown) => path === "feeTypes"
      ? new Promise(resolve => { resolveFees = resolve; })
      : Promise.resolve({ docs: [], metadata: { fromCache: false } }));
    const report = vi.fn();
    const task = startSchoolRefresh(user("cashier"), "year-a", report);
    await vi.advanceTimersByTimeAsync(15001);
    await task.done;
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ section: "financial", error: expect.objectContaining({ code: "client-timeout", collectionPath: "feeTypes" }) }));
    expect(report.mock.calls.some(([result]) => result.section === "financial" && result.data)).toBe(false);
    resolveFees({ docs: [], metadata: { fromCache: false } });
    await vi.advanceTimersByTimeAsync(1);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ section: "financial", data: expect.objectContaining({ feeTypes: [] }) }));
    task.stop();
  });

  it.each(["cache", "pending", "permission-denied", "resource-exhausted"])("ne confirme jamais un groupe financier depuis %s", async (failure) => {
    reads.getDocs.mockImplementation(async (path?: unknown) => {
      if (path === "payments" && failure !== "cache" && failure !== "pending") throw { code: failure };
      return { docs: [], metadata: { fromCache: path === "payments" && failure === "cache", hasPendingWrites: path === "payments" && failure === "pending" } };
    });
    const report = vi.fn();
    const task = startSchoolRefresh(user("school_admin"), "year-a", report);
    await task.done;
    expect(report.mock.calls.some(([result]) => result.section === "financial" && result.data)).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ section: "financial", error: expect.objectContaining({ collectionPath: "payments" }) }));
    task.stop();
  });

  it("ignore une réponse de l'année ou de la session quittée sans modifier les files locales", async () => {
    vi.useFakeTimers();
    const pending: Array<(value: { docs: never[]; metadata: { fromCache: boolean } }) => void> = [];
    reads.getDocs.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const report = vi.fn();
    const task = startSchoolRefresh(user("school_admin"), "year-a", report);
    task.stop();
    await task.done;
    pending.forEach(resolve => resolve({ docs: [], metadata: { fromCache: false } }));
    await vi.advanceTimersByTimeAsync(16000);
    expect(report).not.toHaveBeenCalled();
  });

  it("ne lit pas les présences pour le Caissier et refuse un rôle non autorisé", async () => {
    const task = startSchoolRefresh(user("cashier"), "year-a", vi.fn());
    await task.done;
    expect(reads.getDocs.mock.calls.some(([path]) => String(path).startsWith("attendance"))).toBe(false);
    task.stop();
    expect(() => startSchoolRefresh(user("teacher"), "year-a", vi.fn())).toThrow();
  });
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
