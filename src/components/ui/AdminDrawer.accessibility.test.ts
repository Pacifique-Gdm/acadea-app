import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/ui/AdminDrawer.tsx", "utf8");

describe("accessibilité des Drawers imbriqués", () => {
  it("utilise un identifiant de titre unique par instance", () => {
    expect(source).toContain("useId");
    expect(source).toContain("const titleId = useId()");
    expect(source).toContain("aria-labelledby={titleId}");
    expect(source).toContain("id={titleId}");
    expect(source).not.toContain('id="drawer-title"');
  });
});
