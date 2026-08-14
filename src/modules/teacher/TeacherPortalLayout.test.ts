import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const teacherPortal = readFileSync(new URL("./TeacherPortal.tsx", import.meta.url), "utf8");
const studyPortal = readFileSync(new URL("../studies/StudyDirectorPortal.tsx", import.meta.url), "utf8");

describe("responsive portal layouts", () => {
  it("uses two dashboard cards per row where space permits", () => {
    expect(teacherPortal).toContain("grid-cols-1 gap-4 sm:grid-cols-2");
    expect(teacherPortal).not.toContain('sm:grid-cols-2 lg:grid-cols-3"><DashboardCard');
  });

  it("wraps courses and schedule in the shared panel", () => {
    expect(teacherPortal.match(/<FormPanel title="">/g)).toHaveLength(2);
  });

  it("keeps teacher and study-director menu entries vertical with horizontal icon/title alignment", () => {
    expect(teacherPortal).toContain('<div className="grid gap-3">');
    expect(teacherPortal).toContain('className="flex items-center gap-3"');
    expect(studyPortal).toContain('const menuButton = "flex items-center gap-3');
    expect(studyPortal).not.toContain('className="mt-2 block"');
  });
});
