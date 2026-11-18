import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSchoolLogoVersion, loadSchoolLogo, peekSchoolLogo, primeSchoolLogo, resetSchoolLogoCacheForTests, schoolHasLogo } from "./schoolLogo";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { schoolLogoVersion } from "../../api/_lib/schoolLogo.js";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values };
}

afterEach(() => resetSchoolLogoCacheForTests());

describe("logo de l'école rangé à part", () => {
  it("affiche directement l'ancien champ logoUrl, sans aucune lecture", async () => {
    const loader = vi.fn();
    resetSchoolLogoCacheForTests({ loader, storage: null });
    const school = { id: "s1", logoUrl: LOGO };
    expect(peekSchoolLogo(school)).toBe(LOGO);
    await expect(loadSchoolLogo(school)).resolves.toBe(LOGO);
    expect(loader).not.toHaveBeenCalled();
  });

  it("n'effectue aucune lecture pour une école sans logo", async () => {
    const loader = vi.fn();
    resetSchoolLogoCacheForTests({ loader, storage: null });
    await expect(loadSchoolLogo({ id: "s1" })).resolves.toBe("");
    await expect(loadSchoolLogo({ id: "s1", logoVersion: "" })).resolves.toBe("");
    expect(schoolHasLogo({ id: "s1" })).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  it("lit le logo rangé à part une seule fois par version, puis le garde en mémoire", async () => {
    const loader = vi.fn(async () => ({ logoUrl: LOGO, logoVersion: "v1" }));
    resetSchoolLogoCacheForTests({ loader, storage: null });
    const school = { id: "s1", logoVersion: "v1" };
    expect(schoolHasLogo(school)).toBe(true);
    expect(peekSchoolLogo(school)).toBeUndefined();
    const [first, second] = await Promise.all([loadSchoolLogo(school), loadSchoolLogo(school)]);
    expect(first).toBe(LOGO);
    expect(second).toBe(LOGO);
    await expect(loadSchoolLogo(school)).resolves.toBe(LOGO);
    expect(peekSchoolLogo(school)).toBe(LOGO);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("relit le logo quand sa version change", async () => {
    const loader = vi.fn(async () => ({ logoUrl: LOGO }));
    resetSchoolLogoCacheForTests({ loader, storage: null });
    await loadSchoolLogo({ id: "s1", logoVersion: "v1" });
    await loadSchoolLogo({ id: "s1", logoVersion: "v2" });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("garde le logo sur l'appareil : aucune lecture au prochain démarrage", async () => {
    const storage = memoryStorage();
    resetSchoolLogoCacheForTests({ loader: async () => ({ logoUrl: LOGO }), storage });
    await loadSchoolLogo({ id: "s1", logoVersion: "v1" });
    const loader = vi.fn();
    resetSchoolLogoCacheForTests({ loader, storage });
    expect(peekSchoolLogo({ id: "s1", logoVersion: "v1" })).toBe(LOGO);
    expect(peekSchoolLogo({ id: "s1", logoVersion: "v2" })).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it("réessaie après une lecture impossible (hors ligne)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loader = vi.fn().mockRejectedValueOnce(new Error("hors ligne")).mockResolvedValueOnce({ logoUrl: LOGO });
    resetSchoolLogoCacheForTests({ loader, storage: null });
    await expect(loadSchoolLogo({ id: "s1", logoVersion: "v1" })).resolves.toBe("");
    await expect(loadSchoolLogo({ id: "s1", logoVersion: "v1" })).resolves.toBe(LOGO);
    expect(loader).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("connaît le nouveau logo juste après l'enregistrement, sans relecture", async () => {
    const loader = vi.fn();
    resetSchoolLogoCacheForTests({ loader, storage: null });
    primeSchoolLogo("s1", "v9", LOGO);
    await expect(loadSchoolLogo({ id: "s1", logoVersion: "v9" })).resolves.toBe(LOGO);
    expect(loader).not.toHaveBeenCalled();
  });

  it("calcule le même repère de version que le serveur et la migration", async () => {
    await expect(computeSchoolLogoVersion(LOGO)).resolves.toBe(schoolLogoVersion(LOGO));
    await expect(computeSchoolLogoVersion("")).resolves.toBe("");
  });
});
