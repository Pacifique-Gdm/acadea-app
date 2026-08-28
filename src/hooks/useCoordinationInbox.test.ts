import { describe, expect, it } from "vitest";
import { mergeCoordinationInboxItems } from "./useCoordinationInbox";

describe("inbox temps réel Coordination", () => {
  it("déduplique et trie les éléments multi-écoles du plus récent au plus ancien", () => {
    const groups = new Map([
      ["school-a", [{ id: "a", createdAt: "2026-08-27T10:00:00.000Z" }, { id: "shared", createdAt: "2026-08-27T11:00:00.000Z" }]],
      ["school-b", [{ id: "b", createdAt: "2026-08-28T10:00:00.000Z" }, { id: "shared", createdAt: "2026-08-27T11:00:00.000Z" }]],
    ]);
    expect(mergeCoordinationInboxItems(groups).map((item) => item.id)).toEqual(["b", "shared", "a"]);
  });
});
