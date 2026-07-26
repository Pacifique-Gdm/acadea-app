import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const firestoreMocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn((_database: unknown, collectionName: string, id: string) => ({ kind: "doc", collectionName, id })),
  collection: vi.fn((_database: unknown, collectionName: string) => ({ kind: "collection", collectionName })),
  query: vi.fn((reference: unknown) => reference),
  where: vi.fn((field: string, operator: string, value: unknown) => ({ field, operator, value })),
  setDoc: vi.fn(),
}));

vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
vi.mock("firebase/firestore", () => firestoreMocks);

import { loadFirestoreBootstrapData } from "../services/firestoreData";

const admin = {
  id: "admin-1",
  name: "Admin Test",
  email: "admin@example.test",
  role: "school_admin",
  schoolId: "school-1",
  status: "active",
} satisfies AppUser;

describe("bootstrap de session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lance en parallèle l'école et les années sans recharger le profil", async () => {
    let resolveSchool: ((value: unknown) => void) | undefined;
    let resolveYears: ((value: unknown) => void) | undefined;
    firestoreMocks.getDoc.mockReturnValue(new Promise((resolve) => { resolveSchool = resolve; }));
    firestoreMocks.getDocs.mockReturnValue(new Promise((resolve) => { resolveYears = resolve; }));

    const loading = loadFirestoreBootstrapData(admin);
    await Promise.resolve();

    expect(firestoreMocks.getDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.getDocs).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.doc).toHaveBeenCalledWith(expect.anything(), "schools", "school-1");
    expect(firestoreMocks.doc).not.toHaveBeenCalledWith(expect.anything(), "users", "admin-1");

    resolveSchool?.({ id: "school-1", exists: () => true, data: () => ({ name: "École Test", status: "active" }) });
    resolveYears?.({ docs: [{ id: "year-1", data: () => ({ schoolId: "school-1", name: "2026-2027", status: "active" }) }] });

    await expect(loading).resolves.toMatchObject({
      users: [admin],
      schools: [{ id: "school-1", status: "active" }],
      schoolYears: [{ id: "year-1", schoolId: "school-1" }],
    });
  });

  it("bloque toujours une école suspendue avant le rendu", async () => {
    firestoreMocks.getDoc.mockResolvedValue({ id: "school-1", exists: () => true, data: () => ({ status: "suspended" }) });
    firestoreMocks.getDocs.mockResolvedValue({ docs: [] });
    await expect(loadFirestoreBootstrapData(admin)).rejects.toThrow("suspendue");
  });
});
