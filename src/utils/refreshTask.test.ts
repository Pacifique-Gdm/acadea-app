import { describe, expect, it, vi } from "vitest";
import { runRefreshTask } from "./refreshTask";
import { retryableRefreshError } from "./refreshErrors";

describe("runRefreshTask", () => {
  it("remplace les données seulement après une lecture réussie", async () => {
    let data = ["ancienne"];
    const refreshing: boolean[] = [];
    const result = await runRefreshTask({ lock: { current: false }, setRefreshing: (value) => refreshing.push(value), load: async () => ["nouvelle"], apply: (next) => { data = next; }, onError: vi.fn() });
    expect(result).toBe(true);
    expect(data).toEqual(["nouvelle"]);
    expect(refreshing).toEqual([true, false]);
  });

  it("conserve les anciennes données, libère le verrou et permet une deuxième tentative", async () => {
    const lock = { current: false };
    let data = ["ancienne"];
    const onError = vi.fn();
    const failed = await runRefreshTask({ lock, setRefreshing: vi.fn(), load: async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); }, apply: (next: string[]) => { data = next; }, onError });
    expect(failed).toBe(false);
    expect(data).toEqual(["ancienne"]);
    expect(lock.current).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    const retried = await runRefreshTask({ lock, setRefreshing: vi.fn(), load: async () => ["après reprise"], apply: (next) => { data = next; }, onError });
    expect(retried).toBe(true);
    expect(data).toEqual(["après reprise"]);
  });

  it("bloque un deuxième lancement simultané", async () => {
    const lock = { current: false };
    let resolveLoad: (value: string[]) => void = () => undefined;
    const load = vi.fn(() => new Promise<string[]>((resolve) => { resolveLoad = resolve; }));
    const first = runRefreshTask({ lock, setRefreshing: vi.fn(), load, apply: vi.fn(), onError: vi.fn() });
    const second = await runRefreshTask({ lock, setRefreshing: vi.fn(), load, apply: vi.fn(), onError: vi.fn() });
    expect(second).toBe(false);
    expect(load).toHaveBeenCalledOnce();
    resolveLoad(["ok"]);
    await first;
  });

  it("réessaie une seule fois un réseau indisponible et n'affiche pas une fausse erreur", async () => {
    const load = vi.fn().mockRejectedValueOnce({ code: "unavailable" }).mockResolvedValueOnce(["nouvelle"]);
    const onError = vi.fn();
    const apply = vi.fn();
    expect(await runRefreshTask({ lock: { current: false }, setRefreshing: vi.fn(), load, apply, onError,
      retryOnError: retryableRefreshError, retryDelayMs: 0 })).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith(["nouvelle"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ne relance pas un refus de permission et conserve les données", async () => {
    const load = vi.fn().mockRejectedValue({ code: "permission-denied" });
    const apply = vi.fn();
    expect(await runRefreshTask({ lock: { current: false }, setRefreshing: vi.fn(), load, apply, onError: vi.fn(),
      retryOnError: retryableRefreshError, retryDelayMs: 0 })).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });
});
