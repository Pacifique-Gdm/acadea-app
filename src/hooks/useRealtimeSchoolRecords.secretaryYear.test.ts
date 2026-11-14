import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => name),
  where: vi.fn((field, op, value) => ({ field, op, value })),
  query: vi.fn((...parts) => ({ parts })),
  onSnapshot: vi.fn(() => vi.fn()),
}));
vi.mock("firebase/firestore", () => mocks);
vi.mock("../firebase", () => ({ db: {} }));
const effects: Array<() => void | (() => void)> = [];
vi.mock("react", () => ({ useEffect: (effect: () => void | (() => void)) => effects.push(effect) }));

import { useRealtimeSchoolRecords } from "./useRealtimeSchoolRecords";

const user = (role: string) => ({ id: `user-${role}`, name: "Test", email: "test@acadea.test", role, schoolId: "school-1", status: "active" }) as never;
const studentQuery = () => (mocks.query.mock.calls as unknown[][]).find((parts) => parts[0] === "students");

describe("secrétaire limitée à l'année choisie", () => {
  beforeEach(() => { effects.length = 0; vi.clearAllMocks(); });

  it("écoute les élèves de l'école ET de l'année choisie, pas de toutes les années", () => {
    useRealtimeSchoolRecords({ user: user("secretary"), schoolId: "school-1", schoolYearId: "year-2026", onData: vi.fn() });
    effects[0]();
    expect(studentQuery()).toEqual(["students", { field: "schoolId", op: "==", value: "school-1" }, { field: "schoolYearId", op: "==", value: "year-2026" }]);
  });

  it("garde l'écoute des parents de toute l'école (rattachements multi-années inchangés)", () => {
    useRealtimeSchoolRecords({ user: user("secretary"), schoolId: "school-1", schoolYearId: "year-2026", onData: vi.fn() });
    effects[0]();
    expect((mocks.query.mock.calls as unknown[][]).find((parts) => parts[0] === "parents")).toEqual(["parents", { field: "schoolId", op: "==", value: "school-1" }]);
  });

  it("le chargement initial de la secrétaire utilise aussi le filtre annuel", () => {
    const source = readFileSync(new URL("../services/firestoreData.ts", import.meta.url), "utf8");
    const secretaryBlock = source.slice(source.indexOf('if (user.role === "secretary") {'), source.indexOf('if (user.role === "secretary") {') + 600);
    expect(secretaryBlock).toContain('maybeLoad("students", () => loadCollection<AppData["students"][number]>("students", annualFilter))');
  });
});
