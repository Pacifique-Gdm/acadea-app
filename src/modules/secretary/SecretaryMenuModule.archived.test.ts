import { isValidElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { SecretaryMenuModule } from "./SecretaryMenuModule";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: () => undefined,
}));

function descendants(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}

describe.each([false, true])("accès Secrétaire aux archives — coordination=%s", (coordinated) => {
  it("permet active → archive → active via le gestionnaire commun, sans écriture", () => {
    const school: School = { id: "s", name: "École test", address: "", email: "", phone: "", activeSchoolYearId: "active", status: "active", subscriptionPlan: "Starter", subscriptionAmount: 0, ...(coordinated ? { activeCoordinationId: "coord" } : {}) };
    const user: AppUser = { id: "secretary", name: "Test", email: "test@example.invalid", role: "secretary", schoolId: school.id, status: "active" };
    const active: SchoolYear = { id: "active", schoolId: school.id, name: "2027-2028", status: "active", startsAt: "2027-09-01", endsAt: "2028-07-01" };
    const archived: SchoolYear = { ...active, id: "archived", name: "2026-2027", status: "archived" };
    const data: AppData = { users: [user], schools: [school], schoolYears: [active, archived, { ...archived, id: "foreign", schoolId: "other" }], students: [], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
    const onYearChange = vi.fn();
    const updateData = vi.fn();
    for (const [year, next] of [[active, archived], [archived, active]]) {
      const tree = SecretaryMenuModule({ user, data, yearData: data, school, year, updateData, onYearChange, createId: () => "unused", onLogout: vi.fn(), valvesUploadsEnabled: true, maxValveDocumentBytes: 1000 });
      const elements = descendants(tree);
      const selector = elements.find((element) => element.type === "select" && element.props["aria-label"] === "Année scolaire");
      expect(selector, "le Secrétaire doit pouvoir sélectionner une archive existante").toBeDefined();
      expect(selector!.props.value).toBe(year.id);
      expect(descendants(selector!.props.children as ReactNode).filter((element) => element.type === "option").map((element) => element.props.value)).toEqual(["active", "archived"]);
      (selector!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: next.id } });
      expect(onYearChange).toHaveBeenLastCalledWith(next.id);
      expect(updateData).not.toHaveBeenCalled();
      const buttons = elements.filter((element) => element.type === "button");
      expect(buttons.some((element) => /Activer|Archiver|Nouvelle année/.test(JSON.stringify(element.props.children)))).toBe(false);
    }
  });
});

it("raccorde la consultation Secrétaire au changement d'année déjà utilisé par l'Administrateur", () => {
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  expect(app).toMatch(/<SecretaryMenuModule[^>]*onYearChange=\{enterSchoolYear\}/);
});
