import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser, School, SchoolYear } from "../../types";
import { SecretaryReportsModule } from "./SecretaryReportsModule";
import { SecretaryCorrespondenceModule } from "./SecretaryCorrespondenceModule";
import { OutgoingCorrespondenceForm } from "./OutgoingCorrespondenceForm";
import { SecretaryDocumentFormActions } from "./SecretaryDocumentFormActions";

const state = vi.hoisted(() => ({ index: 0, values: new Map<number, unknown>() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.index++;
    return [state.values.has(index) ? state.values.get(index) : typeof initial === "function" ? initial() : initial, vi.fn()];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: () => undefined,
}));
function descendants(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}
beforeEach(() => { state.index = 0; state.values.clear(); });

describe.each([false, true])("documents historiques — coordination=%s", (coordinated) => {
  const school: School = { id: "s", name: "École test", address: "", email: "", phone: "", activeSchoolYearId: "active", status: "active", subscriptionPlan: "Starter", subscriptionAmount: 0, ...(coordinated ? { activeCoordinationId: "coord" } : {}) };
  const user: AppUser = { id: "secretary", name: "Test", email: "test@example.invalid", role: "secretary", schoolId: school.id, status: "active" };
  const year: SchoolYear = { id: "old", schoolId: school.id, name: "2026-2027", status: "archived", startsAt: "2026-09-01", endsAt: "2027-07-01" };

  it.each(["active", "archived"] as const)("bloque les créations uniquement hors année active (%s)", (status) => {
    for (const component of [SecretaryReportsModule, SecretaryCorrespondenceModule]) {
      state.index = 0;
      const tree = component({ user, school, year: { ...year, status } });
      const button = descendants(tree).find(element => element.type === "button");
      expect(Boolean(button?.props.disabled)).toBe(status !== "active");
    }
  });

  it("verrouille aussi un formulaire rapport déjà ouvert dans une archive", () => {
    state.values.set(2, true);
    const elements = descendants(SecretaryReportsModule({ user, school, year }));
    const fields = elements.filter(element => ["input", "textarea", "select"].includes(String(element.type)) && element.props.className === "input");
    expect(fields.length).toBeGreaterThan(3);
    expect(fields.every(element => element.props.disabled === true)).toBe(true);
    expect(elements.find(element => element.type === SecretaryDocumentFormActions)?.props.disabled).toBe(true);
  });

  it("verrouille le courrier entrant déjà ouvert et retire son action Enregistrer", () => {
    state.values.set(7, true);
    state.values.set(9, "incoming");
    const elements = descendants(SecretaryCorrespondenceModule({ user, school, year }));
    const fields = elements.filter(element => element.type === "input" && (element.props.type === "date" || element.props.type === "file" || ["Objet", "Expéditeur", "Destinataire"].includes(String(element.props.placeholder))));
    expect(fields).toHaveLength(5);
    expect(fields.every(element => element.props.disabled === true)).toBe(true);
    expect(elements.some(element => element.type === "button" && element.props.type === "submit")).toBe(false);
  });

  it("verrouille également le formulaire sortant sans empêcher la consultation", () => {
    const elements = descendants(OutgoingCorrespondenceForm({ user, users: [user], school, year, current: null, busy: false, onCancel: vi.fn(), onSave: vi.fn(), onPreview: vi.fn() }));
    expect(elements.find(element => element.type === "fieldset")?.props.disabled).toBe(true);
    expect(elements.find(element => element.type === SecretaryDocumentFormActions)?.props.disabled).toBe(true);
  });
});
