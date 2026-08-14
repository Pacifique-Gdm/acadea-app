import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard cards consistency", () => {
  it("renders the teacher dashboard without the duplicated daily-course band", () => {
    const source = readFileSync(new URL("./TeacherPortal.tsx", import.meta.url), "utf8");
    expect(source).toContain('<DashboardCard title="Cours aujourd’hui"');
    expect(source).toContain('<DashboardCard title="Prochain cours"');
    expect(source).not.toContain("Cours du jour");
    expect(source).toContain("Aucun cours aujourd’hui.");
    expect(source).toContain("Aucun prochain cours.");
    expect(source).toContain("grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3");
    expect(source).toContain("icon={CalendarDays}");
    expect(source).toContain("icon={Clock3}");
  });

  it("uses the shared Admin-style cards for every study-director metric", () => {
    const source = readFileSync(new URL("../studies/StudyDirectorPortal.tsx", import.meta.url), "utf8");
    expect(source).toContain("DashboardCard");
    expect(source).toContain("dashboardCards.map(([label, value, Icon, tone])");
    expect(source).toContain("grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3");
    expect(source).toContain("icon={Icon}");
  });
});
