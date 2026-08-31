import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { emptyStudent } from "../../utils/studentUtils";
import { ArchivedStudentsImportDrawer } from "./StudentAdministrativeTools";
import { importedStudentDocument } from "../../../api/_lib/archivedStudentsImport.js";

const harness = vi.hoisted(() => ({ stateIndex: 0, values: [] as unknown[], request: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [harness.stateIndex < harness.values.length ? harness.values[harness.stateIndex++] : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: () => undefined,
}));
vi.mock("../../services/firestoreData", () => ({ loadFirestoreYearData: harness.refresh }));
vi.mock("../../services/provisioning", () => ({ requestArchivedStudentsImport: harness.request }));

function descendants(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}

beforeEach(() => {
  harness.stateIndex = 0;
  harness.values = ["old", "IMPORTER LES ELEVES", { sourceCount: 1, complete: false, remaining: 1, status: "legacy-incomplete" }, "", false, false, false];
  harness.request.mockReset().mockResolvedValue({ sourceCount: 1, complete: true, importedCount: 1, remaining: 0 });
  harness.refresh.mockReset().mockResolvedValue({ students: [] });
});

describe("régression de l'import avant normalisation et publication", () => {
  it.each([false, true])("ne remet jamais une option undefined au persister, coordination=%s", async (coordinated) => {
    const year: SchoolYear = { id: "new", schoolId: "school-a", name: "2027-2028", status: "active", startsAt: "2027-09-01", endsAt: "2028-07-01" };
    const oldYear = { ...year, id: "old", status: "archived" as const };
    const school: School = { id: "school-a", name: "École test", address: "", phone: "", email: "", activeSchoolYearId: year.id, status: "active", subscriptionPlan: "Starter", subscriptionAmount: 0, ...(coordinated ? { activeCoordinationId: "coord-a" } : {}) };
    const user: AppUser = { id: "secretary-a", name: "Secrétaire test", email: "secretary@example.invalid", role: "secretary", schoolId: school.id, status: "active" };
    const student = { ...emptyStudent(school.id, oldYear.id), id: "source", nom: "Test", prenom: "Élève" };
    const data: AppData = { schools: [school], users: [user], schoolYears: [oldYear, year], students: [student], parents: [], feeTypes: [], payments: [], expenses: [], messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
    year.studentsImportedFromArchivedYear = true;
    const tree = ArchivedStudentsImportDrawer({ open: true, onClose: vi.fn(), user, data, school, year, updateData: vi.fn() });
    const button = descendants(tree).find((element) => element.type === "button" && typeof element.props.onClick === "function");
    expect(button).toBeDefined();
    (button!.props.onClick as () => void)();
    await vi.waitFor(() => expect(harness.request).toHaveBeenCalledOnce());
    expect(harness.request).toHaveBeenCalledWith({ schoolId: school.id, schoolYearId: year.id, sourceYearId: oldYear.id, mode: "import", confirmation: "IMPORTER LES ELEVES" });
    const payload = importedStudentDocument(student, school.id, year.id, []);
    expect(payload).not.toHaveProperty("option");
    expect(payload?.schoolYearId).toBe(year.id);
    expect(harness.refresh).toHaveBeenCalledWith(user, year.id);
  });
});
