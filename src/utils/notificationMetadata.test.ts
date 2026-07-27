import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppNotification } from "../types";

describe("métadonnées structurées des notifications internes", () => {
  it("associe absence et retard au document de présence réel", () => {
    const source = readFileSync(new URL("../modules/discipline/DisciplinePortal.tsx", import.meta.url), "utf8");
    expect(source).toContain('resolvedStatus === "absent" || resolvedStatus === "late"');
    expect(source).toContain('event: resolvedStatus === "absent" ? ("student_absent" as const) : ("student_late" as const)');
    expect(source).toContain("attendanceId: record.id");
    expect(source).toContain("studentId: student.id");
    expect(source).toContain("parentId: parent.id");
    expect(source).toContain("schoolId: school.id");
    expect(source).toContain("schoolYearId: year.id");
  });

  it("associe la notification disciplinaire à la sanction et à l'élève réels", () => {
    const source = readFileSync(new URL("../modules/discipline/DisciplinePortal.tsx", import.meta.url), "utf8");
    expect(source).toContain("disciplineSanctionId: sanction.id");
    expect(source).toContain("studentId: sanction.studentId");
    expect(source).toContain('module: "discipline"');
    expect(source).toContain('event: "discipline_incident_created"');
    expect(source).toContain('type: "message"');
  });

  it("associe chaque notification Valve à la publication et à une audience structurée", () => {
    const source = readFileSync(new URL("../components/valves/ValvesDrawerContent.tsx", import.meta.url), "utf8");
    expect(source).toContain("announcementId: publication.id");
    expect(source).toContain('module: "announcements"');
    expect(source).toContain('event: "announcement_published"');
    expect(source).toContain('audienceRoles: ["parent" as const]');
    expect(source).toContain("audienceParentIds: [parent.id]");
    expect(source).toContain('audienceRoles: ["cashier"]');
    expect(source).not.toContain("announcementId: trimmedTitle");
  });

  it("conserve la lisibilité des anciennes notifications sans métadonnées push", () => {
    const legacy: AppNotification = {
      id: "legacy",
      schoolId: "school-a",
      schoolYearId: "year-a",
      type: "attendance",
      title: "Ancienne notification",
      body: "Contenu interne",
      createdAt: "2026-01-01T00:00:00.000Z",
      read: false,
    };
    expect(legacy.module).toBeUndefined();
    expect(legacy.event).toBeUndefined();
  });
});
