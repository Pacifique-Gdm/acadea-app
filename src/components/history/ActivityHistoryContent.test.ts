import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { AppData, AppUser } from "../../types";
import { ActivityHistoryContent } from "./ActivityHistoryContent";

describe("Historique responsive", () => {
  const source = readFileSync(new URL("./ActivityHistoryContent.tsx", import.meta.url), "utf8");

  it("contraint le contenu à la largeur du drawer sans tableau horizontal", () => {
    expect(source).toContain("grid w-full min-w-0 max-w-full gap-4");
    expect(source).toContain("min-w-0 max-w-full space-y-2");
    expect(source).toContain("box-border w-full min-w-0 max-w-full rounded");
    expect(source).toContain("input min-w-0 max-w-full");
    expect(source).toContain("break-words text-xs");
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toContain("overflow-x-hidden");
    expect(source).not.toContain("<table");
  });

  it("rend des états de chargement, erreur publique sûre et vide", () => {
    expect(source).toContain("Chargement de l’historique…");
    expect(source).toContain("Impossible de charger l’historique. Veuillez réessayer.");
    expect(source).toContain("Aucune activité disponible.");
  });

  it("rend un Timestamp Firestore sans crash et conserve l'ordre décroissant", () => {
    const user: AppUser = { id: "admin-a", name: "Admin", email: "admin@example.invalid", role: "school_admin", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
    const data: AppData = { users: [user], schools: [], schoolYears: [], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
    const markup = renderToStaticMarkup(createElement(ActivityHistoryContent, { user, data, role: "admin", yearData: {
      students: [], parents: [], users: [user], feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [],
      auditLogs: [
        { id: "older", schoolId: "school-a", actorId: user.id, actorName: user.name, action: "Activité ancienne", createdAt: "2026-08-12T10:00:00.000Z" },
        { id: "newer", schoolId: "school-a", actorId: user.id, actorName: user.name, action: "Activité récente", createdAt: { toMillis: () => Date.parse("2026-08-12T12:00:00.000Z") } as unknown as string },
      ],
    } }));

    expect(markup.indexOf("Activité récente")).toBeLessThan(markup.indexOf("Activité ancienne"));
    expect(markup).not.toContain("Invalid Date");
  });
});
