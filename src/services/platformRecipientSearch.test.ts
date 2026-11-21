import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../firebase", () => ({ auth: { currentUser: { uid: "super-1" } }, db: null, firebaseReady: false }));
vi.mock("firebase/auth", () => ({ getIdToken: vi.fn(async () => "jeton-test") }));

import { clearPlatformRecipientCache, parsePlatformRecipientPage, searchPlatformRecipients } from "./schoolMessaging";

const page = (overrides = {}) => ({ role: "school_admin", page: 0, pageSize: 25, total: 1, unit: "schools", recipients: [{ uid: "a1", name: "Admin", role: "school_admin", schoolId: "s1", coordinationId: null, place: "École A" }], emptySchools: [], ...overrides });

describe("lot SA-6 : recherche des destinataires du Super administrateur", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearPlatformRecipientCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(page()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("demande une page au serveur avec la catégorie, le mot cherché et le numéro de page", async () => {
    const result = await searchPlatformRecipients("school_admin", " Lumbula ", 2);
    expect(result.recipients[0]).toMatchObject({ uid: "a1", place: "École A" });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/message-recipients?");
    expect(new URL(url, "https://exemple.invalid").searchParams.get("role")).toBe("school_admin");
    expect(new URL(url, "https://exemple.invalid").searchParams.get("q")).toBe("Lumbula");
    expect(new URL(url, "https://exemple.invalid").searchParams.get("page")).toBe("2");
  });

  it("ne recharge pas une page déjà vue pendant la session ; « Actualiser la liste » relit", async () => {
    await searchPlatformRecipients("coordination_admin", "", 0);
    await searchPlatformRecipients("coordination_admin", "", 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearPlatformRecipientCache();
    await searchPlatformRecipients("coordination_admin", "", 0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un échec n'est pas gardé : la demande suivante réessaie", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ message: "Trop de demandes." }), { status: 429 }));
    await expect(searchPlatformRecipients("school_admin", "x", 0)).rejects.toThrow("Trop de demandes.");
    await expect(searchPlatformRecipients("school_admin", "x", 0)).resolves.toMatchObject({ total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuse une réponse incomplète", () => {
    expect(() => parsePlatformRecipientPage({ recipients: [] })).toThrow("incomplète");
  });
});
