import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Dashboard Admin/Caissier — temps réel et iPhone", () => {
  const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

  it("isole le padding hors des inputs date pour contourner le calcul de largeur iOS sans masquer le débordement", () => {
    expect(source).toContain('data-testid="dashboard-date-controls"');
    expect(source.match(/type="date"/g)).toHaveLength(2);
    expect(source.match(/data-testid="dashboard-date-field"/g)).toHaveLength(2);
    expect(source.match(/className="dashboard-date-input"/g)).toHaveLength(2);
    expect(source).toContain("grid w-full min-w-0 max-w-full");
    expect(source).not.toContain('data-testid="dashboard-date-controls" className="overflow-x-hidden');
    expect(source).not.toMatch(/type="date"[\s\S]{0,180}className="input/);

    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(styles).toMatch(/\.dashboard-date-field\s*\{[\s\S]*px-3 py-2/);
    expect(styles).toMatch(/\.dashboard-date-input\s*\{[\s\S]*p-0/);
    expect(styles).toContain("min-inline-size: 0;");
  });

  it("branche les vraies classes et les compteurs de personnel partagés", () => {
    expect(source).toContain("subscribeToSchoolClasses(");
    expect(source).toContain("canonicalOperationalClasses(");
    expect(source).toContain("activeDashboardPersonnelCounts(data.users, school.id)");
    expect(source).toContain("uniqueActiveParentCount(filteredParents)");
  });

  it("conserve le snapshot personnel temps réel hors du chargement annuel tardif", () => {
    const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(appSource).toContain("const [realtimeDashboardUsers, setRealtimeDashboardUsers] = useState<AppUser[]>([])");
    expect(appSource).toContain("onUsers: setRealtimeDashboardUsers");
    expect(appSource).toContain("users: realtimeDashboardUsers.length > 0 ? realtimeDashboardUsers : yearData.users");
    expect(appSource).not.toContain("setData((previous) => ({ ...previous, users: reconcileRealtimeSchoolUsers");
  });
});
