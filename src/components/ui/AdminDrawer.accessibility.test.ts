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

  it("borne le Drawer et ses zones internes au viewport mobile", () => {
    expect(source).toContain("box-border");
    expect(source).toContain("max-w-[calc(100vw-1.5rem)]");
    expect(source).toContain("min-w-0");
    expect(source).toContain("overflow-y-auto");
    expect(source).toContain("overflow-x-hidden");
  });
});
