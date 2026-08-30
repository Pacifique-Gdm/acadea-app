import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "test-token" }));
import { closeCoordinationSchoolYears, reactivateCoordinationSchoolYears, YEAR_CONFIRMATIONS } from "./coordinationSchoolYears";
const fetchMock = vi.fn();
describe("confirmations annuelles et contrat UI", () => {
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }); });
  it("transmet le texte brut sans trim ni normalisation", async () => {
    await closeCoordinationSchoolYears(` ${YEAR_CONFIRMATIONS.close} `, "request-1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "close", requestId: "request-1", confirmation: " CLOTURER LES ANNEES SCOLAIRES " });
  });
  it("lie la réactivation à la clôture affichée et à une requête idempotente", async () => {
    await reactivateCoordinationSchoolYears(YEAR_CONFIRMATIONS.reactivate, "closure-1", "request-2");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: "reactivate", operationId: "closure-1", requestId: "request-2", confirmation: "REACTIVER LES ANNEES SCOLAIRES" });
  });
  it("ouvre une confirmation sans mutation immédiate et verrouille les doubles clics", () => {
    const source = readFileSync(new URL("../modules/coordination/CoordinationMenu.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("Clôturer les années prêtes");
    expect(source).toContain('yearGovernance?.status === "closed" ? "Réactiver les années scolaires" : "Clôturer les années scolaires"');
    expect(source).toContain('setYearConfirmation({ action: yearGovernance?.status === "closed"');
    expect(source).not.toContain('onClick={() => void mutateYears("close")}');
    expect(source).toContain("yearConfirmation.value !== YEAR_CONFIRMATIONS");
    expect(source).toContain("if (yearLock.current || !yearStatusReady) return;");
    expect(source).toContain("yearLock.current = true;");
    expect(source).toContain("setYearGovernance(status.governance)");
  });
});
