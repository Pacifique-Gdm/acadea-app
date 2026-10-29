import { describe, expect, it } from "vitest";
import { persistenceStatus, trackPersistence } from "./persistenceStatus";

describe("server persistence feedback", () => {
  it("does not announce success before acknowledgement", async () => {
    let finish!: () => void;
    const saving = trackPersistence(() => new Promise<void>((resolve) => { finish = resolve; }));
    expect(persistenceStatus.getSnapshot()).toEqual({ pending: 1, failed: false, completed: false });
    finish();
    expect(await saving).toBe(true);
    expect(persistenceStatus.getSnapshot()).toEqual({ pending: 0, failed: false, completed: true });
  });
  it("preserves failures when another concurrent operation succeeds", async () => {
    let finish!: () => void;
    const first = trackPersistence(() => new Promise<void>((resolve) => { finish = resolve; }));
    expect(await trackPersistence(async () => { throw new Error("denied"); })).toBe(false);
    expect(persistenceStatus.getSnapshot()).toMatchObject({ pending: 1, failed: true });
    finish(); await first;
    expect(persistenceStatus.getSnapshot()).toMatchObject({ pending: 0, failed: true });
  });
  it("treats an unavailable backend as failure and supports a later successful attempt", async () => {
    expect(await trackPersistence(async () => false)).toBe(false);
    expect(persistenceStatus.getSnapshot().failed).toBe(true);
    expect(await trackPersistence(async () => true)).toBe(true);
    expect(persistenceStatus.getSnapshot().failed).toBe(false);
  });
});
