import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PlatformModule historical dates", () => {
  it("normalizes Firestore timestamps instead of comparing createdAt as strings", () => {
    const source = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");

    expect(source).toContain('import { activityTimestamp } from "../../utils/activityHistory"');
    expect(source).not.toMatch(/createdAt[^\n]*localeCompare|localeCompare\([^\n]*createdAt/);
    expect(source.match(/activityTimestamp\([^)]*\.createdAt\)/g)).toHaveLength(6);
  });
});
