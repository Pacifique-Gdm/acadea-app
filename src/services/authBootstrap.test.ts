import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authNext: undefined as undefined | ((user: { uid: string; email: string } | null) => void),
  authError: undefined as undefined | ((error: unknown) => void),
  profileNext: undefined as undefined | ((snapshot: { exists: () => boolean; data: () => Record<string, unknown> | undefined }) => void),
  profileError: undefined as undefined | ((error: unknown) => void),
  authUnsubscribe: vi.fn(),
  profileUnsubscribe: vi.fn(),
  getIdTokenResult: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../firebase", () => ({ auth: {}, db: {}, firebaseConfig: {}, firebaseReady: true }));
vi.mock("firebase/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db, collection, id) => `${collection}/${id}`),
  onSnapshot: vi.fn((_reference, next, error) => {
    mocks.profileNext = next;
    mocks.profileError = error;
    return mocks.profileUnsubscribe;
  }),
}));
vi.mock("firebase/auth", () => ({
  getIdTokenResult: mocks.getIdTokenResult,
  signOut: mocks.signOut,
  onAuthStateChanged: vi.fn((_auth, next, error) => {
    mocks.authNext = next;
    mocks.authError = error;
    return mocks.authUnsubscribe;
  }),
}));

import { AUTH_BOOTSTRAP_WATCHDOG_MS, subscribeToFirebaseUser } from "./auth";

const profileSnapshot = (profile?: Record<string, unknown>) => ({ exists: () => Boolean(profile), data: () => profile });
const validProfile = { name: "Admin", email: "admin@example.test", status: "active", sectionIds: ["Primaire"] };
const claims = { role: "school_admin", schoolId: "school-a" };

describe("bootstrap Firebase Auth", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.authNext = undefined;
    mocks.authError = undefined;
    mocks.profileNext = undefined;
    mocks.profileError = undefined;
    mocks.getIdTokenResult.mockResolvedValue({ claims });
    mocks.signOut.mockResolvedValue(undefined);
  });

  it("termine immédiatement vers login lorsque Firebase Auth retourne null", async () => {
    const onUser = vi.fn(), onError = vi.fn();
    await subscribeToFirebaseUser(onUser, onError);
    mocks.authNext?.(null);
    expect(onUser).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalled();
  });

  it("utilise un seul listener profil pour le bootstrap et les mises à jour temps réel", async () => {
    const onUser = vi.fn(), onError = vi.fn();
    await subscribeToFirebaseUser(onUser, onError);
    mocks.authNext?.({ uid: "admin-a", email: "admin@example.test" });
    mocks.profileNext?.(profileSnapshot(validProfile));
    await vi.waitFor(() => expect(onUser).toHaveBeenCalledTimes(1));
    mocks.profileNext?.(profileSnapshot({ ...validProfile, sectionIds: ["Primaire", "Secondaire"] }));
    expect(onUser).toHaveBeenCalledTimes(2);
    expect(onUser.mock.calls[1][0]).toMatchObject({ id: "admin-a", role: "school_admin", schoolId: "school-a", sectionIds: ["Primaire", "Secondaire"] });
    expect(mocks.getIdTokenResult).toHaveBeenCalledTimes(1);
  });

  it("termine le loader sur erreur Firestore et profil absent", async () => {
    const onUser = vi.fn(), onError = vi.fn();
    await subscribeToFirebaseUser(onUser, onError);
    mocks.authNext?.({ uid: "admin-a", email: "admin@example.test" });
    mocks.profileError?.(new Error("permission-denied"));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "permission-denied" }));

    await subscribeToFirebaseUser(onUser, onError);
    mocks.authNext?.({ uid: "missing", email: "missing@example.test" });
    mocks.profileNext?.(profileSnapshot());
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("Aucun profil") }));
  });

  it("sort vers une erreur contrôlée lorsqu'une opération réseau reste suspendue", async () => {
    vi.useFakeTimers();
    const onUser = vi.fn(), onError = vi.fn();
    await subscribeToFirebaseUser(onUser, onError);
    mocks.authNext?.({ uid: "admin-a", email: "admin@example.test" });
    await vi.advanceTimersByTimeAsync(AUTH_BOOTSTRAP_WATCHDOG_MS);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("a expiré") }));
    expect(onUser).not.toHaveBeenCalled();
  });

  it("ignore un ancien callback après remplacement ou démontage du listener", async () => {
    let resolveClaims!: (value: { claims: typeof claims }) => void;
    mocks.getIdTokenResult.mockReturnValue(new Promise((resolve) => { resolveClaims = resolve; }));
    const onUser = vi.fn(), onError = vi.fn();
    const unsubscribe = await subscribeToFirebaseUser(onUser, onError);
    mocks.authNext?.({ uid: "admin-a", email: "admin@example.test" });
    mocks.profileNext?.(profileSnapshot(validProfile));
    unsubscribe();
    resolveClaims({ claims });
    await Promise.resolve();
    await Promise.resolve();
    expect(onUser).not.toHaveBeenCalled();
    expect(mocks.authUnsubscribe).toHaveBeenCalledOnce();
    expect(mocks.profileUnsubscribe).toHaveBeenCalledOnce();
  });
});
