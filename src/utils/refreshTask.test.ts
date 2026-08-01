import { describe, expect, it, vi } from "vitest";
import { runRefreshTask } from "./refreshTask";

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
});
