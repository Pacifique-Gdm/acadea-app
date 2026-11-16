import { describe, expect, it, vi } from "vitest";
import { createOwnPayrollCache, OWN_PAYROLL_CACHE_MS } from "./ownPayrollCache";

describe("lot 26b : Salaire/Prime préparé dès l'affichage du Menu", () => {
  it("un seul appel serveur entre le préchargement et l'ouverture du drawer", async () => {
    let time = 0;
    const loader = vi.fn(async () => ["paiement"]);
    const load = createOwnPayrollCache(loader, () => time);
    await load("u1"); // préchargement à l'affichage du Menu
    time += 30_000;
    expect(await load("u1")).toEqual(["paiement"]); // ouverture du drawer
    expect(loader).toHaveBeenCalledTimes(1);
    time += OWN_PAYROLL_CACHE_MS;
    await load("u1");
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it("un échec n'est pas gardé et un autre compte ne réutilise jamais la liste", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error("réseau")).mockResolvedValue(["ok"]);
    const load = createOwnPayrollCache(loader as () => Promise<string[]>, () => 0);
    await expect(load("u1")).rejects.toThrow("réseau");
    expect(await load("u1")).toEqual(["ok"]);
    await load("u2");
    expect(loader).toHaveBeenCalledTimes(3);
  });
  it("cotes du parent : la clé école + année est transmise au chargeur", async () => {
    const loader = vi.fn(async (key: string) => key);
    const load = createOwnPayrollCache(loader, () => 0);
    expect(await load("ecole|annee")).toBe("ecole|annee");
    await load("ecole|annee");
    expect(loader).toHaveBeenCalledTimes(1);
    await load("ecole|annee", true); // actualisation demandée : nouvelle lecture
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
