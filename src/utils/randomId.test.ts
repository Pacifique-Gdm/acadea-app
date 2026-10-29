import { describe, expect, it, vi } from "vitest";
import { randomId } from "./randomId";
import { randomId as serverId } from "../../api/_lib/randomId.js";

describe("new resource identifiers", () => {
  for (const [name, generate] of [["browser", randomId], ["server", serverId]] as const) {
    it(`${name}: keeps the prefix and produces 32 hexadecimal characters`, () => {
      const ids = Array.from({ length: 10000 }, () => generate("parent"));
      expect(ids.every((id) => /^parent-[a-f0-9]{32}$/.test(id))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
  it("uses all 16 random bytes, without UUID truncation", () => {
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation((buffer) => {
      (buffer as Uint8Array).fill(255);
      return buffer;
    });
    try { expect(randomId("student")).toBe(`student-${"ff".repeat(16)}`); }
    finally { spy.mockRestore(); }
  });
});
