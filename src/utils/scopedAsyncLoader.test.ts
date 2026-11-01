import { describe, expect, it, vi } from "vitest";
import { createScopedAsyncLoader } from "./scopedAsyncLoader";

describe("chargements limités à la session et aux sections courantes", () => {
  it("ne publie pas une ancienne réponse après changement de périmètre", async () => {
    let resolve!: (value: string[]) => void;
    const publish = vi.fn();
    const loader = createScopedAsyncLoader(() => new Promise<string[]>((done) => { resolve = done; }), publish);
    const pending = loader.reload();
    loader.dispose();
    resolve(["ancien-parent"]);
    await pending;
    expect(publish.mock.calls).toEqual([[{ loading: true, error: "" }]]);
    await loader.reload();
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("ne conserve aucune valeur après un refus d'autorisation", async () => {
    const publish = vi.fn();
    const load = vi.fn().mockResolvedValueOnce(["parent"]).mockRejectedValueOnce(new Error("Accès révoqué"));
    const loader = createScopedAsyncLoader(load, publish);
    await loader.reload();
    await loader.reload();
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({ loading: false, error: "Accès révoqué" });
  });
  it("regroupe les actualisations simultanées sans perdre le réessai", async () => {
    let resolve!: (value: string[]) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<string[]>((done) => { resolve = done; })).mockResolvedValue(["nouveau"]);
    const publish = vi.fn();
    const loader = createScopedAsyncLoader(load, publish);
    const first = loader.reload();
    await loader.reload();
    await loader.reload();
    resolve(["premier"]);
    await first;
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.at(-1)?.[0].value).toEqual(["nouveau"]);
  });
});
