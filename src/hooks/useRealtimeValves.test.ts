import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser, ParentProfile, Student, ValvePublication } from "../types";
import { parentCanViewValvePublication } from "../utils/valves";

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn(() => "valves-collection"),
  where: vi.fn((field: string, operator: string, value: string) => ({ field, operator, value })),
  query: vi.fn((...parts: unknown[]) => ({ parts })),
  onSnapshot: vi.fn(),
}));

vi.mock("@firebase/firestore", () => firestoreMocks);
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));

import {
  canSubscribeToRealtimeValves,
  reconcileRealtimeValves,
  subscribeToRealtimeValves,
} from "./useRealtimeValves";

const user = (role: AppUser["role"] = "school_admin", overrides: Partial<AppUser> = {}): AppUser => ({
  id: `${role}-user`, name: "Utilisateur", email: "user@example.test", role, schoolId: "school-a", status: "active", ...overrides,
});
const valve = (id: string, createdAt: string, overrides: Partial<ValvePublication> = {}): ValvePublication => ({
  id, schoolId: "school-a", schoolYearId: "year-a", title: id, kind: "communique", visibility: "all_parents", body: "Texte", authorId: "admin", authorName: "Admin", createdAt, ...overrides,
});

describe("temps réel des Valves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("réconcilie créations, modifications et suppressions sans doublon", () => {
    const current = [valve("updated", "2026-01-01", { title: "Ancien" }), valve("deleted", "2025-01-01"), valve("foreign", "2024-01-01", { schoolId: "school-b" })];
    const incoming = [valve("created", "2026-03-01"), valve("updated", "2026-02-01", { title: "Nouveau" }), valve("updated", "2026-02-01", { title: "Nouveau" })];
    const result = reconcileRealtimeValves(current, incoming, { schoolId: "school-a", schoolYearId: "year-a" });
    expect(result.map((item) => item.id)).toEqual(["created", "updated", "foreign"]);
    expect(result.find((item) => item.id === "updated")?.title).toBe("Nouveau");
    expect(result.filter((item) => item.id === "updated")).toHaveLength(1);
  });

  it("isole l'école et l'année et conserve un ordre stable à date identique", () => {
    const first = valve("first", "2026-02-01");
    const second = valve("second", "2026-02-01");
    const otherYear = valve("other-year", "2026-04-01", { schoolYearId: "year-b" });
    const result = reconcileRealtimeValves([first, second, otherYear], [second, first], { schoolId: "school-a", schoolYearId: "year-a" });
    expect(result.map((item) => item.id)).toEqual(["other-year", "first", "second"]);
  });

  it.each(["school_admin", "cashier", "discipline_director", "secretary", "parent"] as const)("autorise le rôle %s", (role) => {
    expect(canSubscribeToRealtimeValves(user(role), "school-a", "year-a")).toBe(true);
  });

  it("refuse un compte inactif, le Super Administrateur et les périmètres incomplets", () => {
    expect(canSubscribeToRealtimeValves(user("parent", { status: "inactive" }), "school-a", "year-a")).toBe(false);
    expect(canSubscribeToRealtimeValves(user("super_admin"), "school-a", "year-a")).toBe(false);
    expect(canSubscribeToRealtimeValves(user(), "school-b", "year-a")).toBe(false);
    expect(canSubscribeToRealtimeValves(user(), "school-a", "")).toBe(false);
  });

  it("conserve le ciblage Parent existant", () => {
    const parent = { id: "parent-a", studentIds: ["student-a"] } as ParentProfile;
    const students = [{ id: "student-a", parentId: "parent-a", className: "1ère Primaire" }] as Student[];
    expect(parentCanViewValvePublication(valve("allowed", "2026-01-01", { visibility: "Primaire" }), parent, students)).toBe(true);
    expect(parentCanViewValvePublication(valve("denied", "2026-01-01", { visibility: "Secondaire" }), parent, students)).toBe(false);
  });

  it("crée une seule écoute ciblée et transmet chaque snapshot", () => {
    const unsubscribe = vi.fn();
    let receiveSnapshot: ((snapshot: { docs: Array<{ id: string; data(): Omit<ValvePublication, "id"> }> }) => void) | undefined;
    firestoreMocks.onSnapshot.mockImplementation((_query, next) => {
      receiveSnapshot = next;
      return unsubscribe;
    });
    const onValves = vi.fn();
    const stop = subscribeToRealtimeValves({ database: {} as never, user: user("cashier"), schoolId: "school-a", schoolYearId: "year-a", onValves });
    expect(firestoreMocks.onSnapshot).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.where).toHaveBeenNthCalledWith(1, "schoolId", "==", "school-a");
    expect(firestoreMocks.where).toHaveBeenNthCalledWith(2, "schoolYearId", "==", "year-a");
    receiveSnapshot?.({ docs: [{ id: "created", data: () => valve("created", "2026-01-01") }] });
    expect(onValves).toHaveBeenCalledWith([expect.objectContaining({ id: "created" })], { schoolId: "school-a", schoolYearId: "year-a" });
    stop?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("recrée proprement l'écoute lorsque l'identité, l'école ou l'année changent", () => {
    const unsubscribes = [vi.fn(), vi.fn(), vi.fn()];
    firestoreMocks.onSnapshot.mockImplementationOnce(() => unsubscribes[0]).mockImplementationOnce(() => unsubscribes[1]).mockImplementationOnce(() => unsubscribes[2]);
    const onValves = vi.fn();
    subscribeToRealtimeValves({ database: {} as never, user: user(), schoolId: "school-a", schoolYearId: "year-a", onValves })?.();
    subscribeToRealtimeValves({ database: {} as never, user: user("cashier", { id: "other" }), schoolId: "school-a", schoolYearId: "year-a", onValves })?.();
    subscribeToRealtimeValves({ database: {} as never, user: user("cashier", { id: "other", schoolId: "school-b" }), schoolId: "school-b", schoolYearId: "year-b", onValves })?.();
    expect(firestoreMocks.onSnapshot).toHaveBeenCalledTimes(3);
    unsubscribes.forEach((unsubscribe) => expect(unsubscribe).toHaveBeenCalledOnce());
  });

  it("conserve les dernières données si Firestore signale une erreur", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let reportError: ((error: Error) => void) | undefined;
    firestoreMocks.onSnapshot.mockImplementation((_query, _next, error) => {
      reportError = error;
      return vi.fn();
    });
    const onValves = vi.fn();
    subscribeToRealtimeValves({ database: {} as never, user: user(), schoolId: "school-a", schoolYearId: "year-a", onValves });
    reportError?.(new Error("network"));
    expect(onValves).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("ne dépend pas du Drawer et n'ajoute ni rechargement ni polling", () => {
    const hookSource = readFileSync(new URL("./useRealtimeValves.ts", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(`${hookSource}\n${appSource}`).not.toContain("window.location.reload");
    expect(hookSource).not.toContain("setInterval");
    expect(hookSource).not.toContain("setTimeout");
    expect(hookSource).not.toContain("ValvesDrawerContent");
  });
});
