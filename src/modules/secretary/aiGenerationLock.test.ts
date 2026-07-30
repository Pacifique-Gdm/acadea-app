import { describe, expect, it } from "vitest";
import { withAiGenerationLock } from "./aiGenerationLock";

describe("verrou de génération IA", () => {
  it.each(["erreur", "AI_NO_TRANSFORMATION", "timeout"])("libère immédiatement le verrou après %s", async (message) => {
    const lock = { current: false };
    const busy: boolean[] = [];
    await expect(withAiGenerationLock(lock, (value) => busy.push(value), async () => { throw new Error(message); })).rejects.toThrow(message);
    expect(lock.current).toBe(false);
    expect(busy).toEqual([true, false]);
    await expect(withAiGenerationLock(lock, (value) => busy.push(value), async () => "nouvelle génération")).resolves.toMatchObject({ started: true, value: "nouvelle génération" });
  });

  it("autorise deux générations réussies successives et bloque seulement le chevauchement", async () => {
    const lock = { current: false };
    const setBusy = () => undefined;
    await expect(withAiGenerationLock(lock, setBusy, async () => 1)).resolves.toMatchObject({ started: true, value: 1 });
    await expect(withAiGenerationLock(lock, setBusy, async () => 2)).resolves.toMatchObject({ started: true, value: 2 });
    lock.current = true;
    await expect(withAiGenerationLock(lock, setBusy, async () => 3)).resolves.toEqual({ started: false });
  });
});
