import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { AppData, AppUser } from "../../types";
import { ActivityHistoryContent } from "./ActivityHistoryContent";

const todayAt = (hours: number, minutes: number) => { const value = new Date(); value.setHours(hours, minutes, 0, 0); return value; };

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
        // Dates d'aujourd'hui : l'historique de l'Administrateur s'ouvre sur « aujourd'hui ».
        { id: "older", schoolId: "school-a", actorId: user.id, actorName: user.name, action: "Activité ancienne", createdAt: todayAt(0, 5).toISOString() },
        { id: "newer", schoolId: "school-a", actorId: user.id, actorName: user.name, action: "Activité récente", createdAt: { toMillis: () => todayAt(0, 10).getTime() } as unknown as string },
      ],
    } }));

    expect(markup.indexOf("Activité récente")).toBeLessThan(markup.indexOf("Activité ancienne"));
    expect(markup).not.toContain("Invalid Date");
  }, 15_000);

  it("expose les filtres Paiements et Dépenses au Caissier", () => {
    const user: AppUser = { id: "cashier-a", name: "Caissier", email: "cashier@example.invalid", role: "cashier", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
    const data: AppData = { users: [user], schools: [], schoolYears: [], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
    const markup = renderToStaticMarkup(createElement(ActivityHistoryContent, { user, data, role: "cashier", yearData: {
      students: [], parents: [], users: [user], feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [], auditLogs: [],
    } }));

    expect(markup).toContain('<option value="payment">Paiements</option>');
    expect(markup).toContain('<option value="expense">Dépenses</option>');
  });
  it("Administrateur : les dates s'ouvrent sur « aujourd'hui » et la liste ne montre que les activités du jour", () => {
    const user: AppUser = { id: "admin-a", name: "Admin", email: "admin@example.invalid", role: "school_admin", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active" };
    const data: AppData = { users: [user], schools: [], schoolYears: [], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
    const yesterday = todayAt(12, 0); yesterday.setDate(yesterday.getDate() - 1);
    const markup = renderToStaticMarkup(createElement(ActivityHistoryContent, { user, data, role: "admin", yearData: {
      students: [], parents: [], users: [user], feeTypes: [], payments: [], expenses: [], messages: [], disciplineSanctions: [],
      auditLogs: [
        { id: "today", schoolId: "school-a", actorId: user.id, actorName: user.name, action: "Activité du jour", createdAt: todayAt(0, 30).toISOString() },
        { id: "yesterday", schoolId: "school-a", actorId: user.id, actorName: user.name, action: "Activité de la veille", createdAt: yesterday.toISOString() },
      ],
    } }));
    const today = todayAt(12, 0); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(markup).toContain(`aria-label="Début de la période" class="input min-w-0 max-w-full" value="${iso}"`);
    expect(markup).toContain(`aria-label="Fin de la période" class="input min-w-0 max-w-full" value="${iso}"`);
    expect(markup).toContain("Activité du jour");
    expect(markup).not.toContain("Activité de la veille");
  }, 15_000);
});
