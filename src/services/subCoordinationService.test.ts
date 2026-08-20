import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: vi.fn(async () => "staging-token") }));

import {
  addSubCoordinationSchool,
  archiveSubCoordination,
  createSubCoordination,
  nextSubCoordinationEmail,
  reactivateSubCoordination,
  removeSubCoordinationSchool,
  transferSubCoordinationSchool,
} from "./subCoordinationService";

describe("service Sous-coordination", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => ({ input: JSON.parse(String(init?.body ?? "{}")) }) })));
  });

  it("génère un e-mail lisible sans collision selon la convention existante", () => {
    const users = [{ email: "subcoord001@coordinationnord.com" }, { email: "SUBCOORD002@coordinationnord.com" }] as AppUser[];
    expect(nextSubCoordinationEmail("Coordination Nord", users)).toBe("subcoord003@coordinationnord.com");
  });

  it("transmet les claims métier indirectement via l’action serveur de création", async () => {
    await createSubCoordination({ circumscription: "Commune de Gombe", schoolIds: ["school-a", "school-b"], coordinator: { lastName: "Kabeya", phone: "0991234567", email: "subcoord001@example.test", password: "0991234567" } });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/manage-coordination"), expect.objectContaining({ method: "POST", body: expect.stringContaining('"action":"create-sub-coordination"') }));
  });

  it("utilise le même endpoint sécurisé pour ajouter, retirer, transférer, archiver et réactiver", async () => {
    await addSubCoordinationSchool("sub-a", "school-a");
    await removeSubCoordinationSchool("sub-a", "school-a");
    await transferSubCoordinationSchool("sub-a", "sub-b", "school-a");
    await archiveSubCoordination("sub-a");
    await reactivateSubCoordination("sub-a");
    const actions = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).action);
    expect(actions).toEqual(["add-sub-school", "remove-sub-school", "transfer-sub-school", "archive-sub-coordination", "reactivate-sub-coordination"]);
  });
});
