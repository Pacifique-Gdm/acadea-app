import { describe, expect, it } from "vitest";
import { coordinationSchoolBatches, mapCoordinationSchoolBatches } from "./coordinationSchoolBatches";

describe("coordination school reads", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 14, 30, 50, 100, 101, 200])("covers %i schools exactly once within the rule budget", (count) => {
    const ids = Array.from({ length: count }, (_, index) => `school-${index}`);
    for (const [isDelegate, limit] of [[false, 6], [true, 3]] as const) {
      const batches = coordinationSchoolBatches([...ids, ids[0]], isDelegate);
      expect(batches.flat()).toEqual(ids);
      expect(batches.every((batch) => batch.length > 0 && batch.length <= limit)).toBe(true);
      expect(batches).toHaveLength(Math.ceil(count / limit));
    }
  });

  it("bounds concurrent requests and preserves school order", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `school-${index}`);
    let active = 0;
    let peak = 0;
    const batches = await mapCoordinationSchoolBatches(ids, false, async (batch) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, batch[0] === "school-0" ? 10 : 1));
      active--;
      return batch;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(ids);
  });

  it("rejects a failed batch instead of returning a partial school list", async () => {
    const ids = Array.from({ length: 14 }, (_, index) => `school-${index}`);
    await expect(mapCoordinationSchoolBatches(ids, false, async (batch) => {
      if (batch.includes("school-6")) throw new Error("permission-denied");
      return batch;
    })).rejects.toThrow("permission-denied");
  });
});
