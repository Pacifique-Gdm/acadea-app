import { beforeEach, describe, expect, it, vi } from "vitest";
const callbacks = vi.hoisted(() => new Map<string, { next: (snapshot: unknown) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> }>());
vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => name, query: (name: string) => name, where: vi.fn(), doc: vi.fn(), setDoc: vi.fn(),
  onSnapshot: (name: string, next: (snapshot: unknown) => void, error: (error: Error) => void) => {
    const stop = vi.fn(); callbacks.set(name, { next, error, stop }); return stop;
  },
}));
import { subscribeTeacherLearning } from "./teacherLearningService";
import type { AppUser } from "../../types";
const user = { role: "teacher", schoolId: "s", active: true } as AppUser;
describe("teacher loading lifecycle", () => {
  beforeEach(() => callbacks.clear());
  it("waits for all three initial snapshots, then emits live updates and disposes listeners", () => {
    const data = vi.fn(); const stop = subscribeTeacherLearning(user, "s", "y", "t", data, vi.fn());
    callbacks.get("teachingProgress")!.next({ docs: [] });
    callbacks.get("teacherStudentObservations")!.next({ docs: [] });
    expect(data).not.toHaveBeenCalled();
    callbacks.get("pedagogicalDocuments")!.next({ docs: [] });
    expect(data).toHaveBeenCalledTimes(1);
    callbacks.get("pedagogicalDocuments")!.next({ docs: [{ id: "legacy-12345678", data: () => ({ title: "Test" }) }] });
    expect(data.mock.lastCall?.[0].documents[0].title).toBe("Test");
    stop(); for (const callback of callbacks.values()) expect(callback.stop).toHaveBeenCalledTimes(1);
  });
  it("does not clear a failed subscription with an unrelated successful snapshot", () => {
    const data = vi.fn(), error = vi.fn(); subscribeTeacherLearning(user, "s", "y", "t", data, error);
    callbacks.get("pedagogicalDocuments")!.error(new Error("denied"));
    for (const callback of callbacks.values()) callback.next({ docs: [] });
    expect(error).toHaveBeenCalledOnce(); expect(data).not.toHaveBeenCalled();
  });
  it("still rejects wrong-school and inactive teachers", () => {
    expect(() => subscribeTeacherLearning(user, "other", "y", "t", vi.fn(), vi.fn())).toThrow();
    expect(() => subscribeTeacherLearning({ ...user, active: false }, "s", "y", "t", vi.fn(), vi.fn())).toThrow();
  });
});
