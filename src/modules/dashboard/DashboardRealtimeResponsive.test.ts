import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Dashboard Admin/Caissier — temps réel et iPhone", () => {
  const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

  it("supprime la largeur intrinsèque iOS des dates sans masquer le débordement", () => {
    expect(source).toContain('data-testid="dashboard-date-controls"');
    expect(source.match(/type="date"/g)).toHaveLength(2);
    expect(source.match(/\[min-inline-size:0\]/g)).toHaveLength(2);
    expect(source).toContain("grid w-full min-w-0 max-w-full");
    expect(source).not.toContain('data-testid="dashboard-date-controls" className="overflow-x-hidden');
  });

  it("branche les vraies classes et les compteurs de personnel partagés", () => {
    expect(source).toContain("subscribeToSchoolClasses(");
    expect(source).toContain("canonicalOperationalClasses(");
    expect(source).toContain("activeDashboardPersonnelCounts(data.users, school.id)");
    expect(source).toContain("uniqueActiveParentCount(filteredParents)");
  });
});
