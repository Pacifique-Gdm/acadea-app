import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../types";

vi.mock("../../services/auth", () => ({ getCurrentFirebaseIdToken: vi.fn(async () => "test-token") }));
import { canReadPublishedTimetable, subscribeToActivePublishedTimetable } from "./publishedTimetableService";

const user: AppUser = { id: "secretary", name: "Secrétaire", email: "secretary@example.test", role: "secretary", schoolId: "school-a" };
const unsubscribes: Array<() => void> = [];
const fetchMock = vi.fn();

describe("lecture sécurisée de l'horaire publié", () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("interroge l'API authentifiée sans transmettre d'école choisie par le client", async () => {
    const timetable = { version: 1, rows: [{ dayOfWeek: "monday", periodLabel: "P1 · 08:00–09:00", startTime: "08:00", classLabel: "4e Humanité", subjectLabel: "Mathématiques", teacherDisplayName: "Ada Lovelace" }] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ timetable }) });
    const onData = vi.fn();
    unsubscribes.push(subscribeToActivePublishedTimetable({ user, schoolId: "school-a", schoolYearId: "year-a", onData, onError: vi.fn() }));
    await vi.waitFor(() => expect(onData).toHaveBeenCalledWith(timetable));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("view=published-timetable");
    expect(url).toContain("schoolYearId=year-a");
    expect(url).not.toContain("schoolId=");
    expect(options).toMatchObject({ method: "GET", headers: { Authorization: "Bearer test-token" }, cache: "no-store" });
  });

  it("retourne un état vide et signale une erreur sans conserver une nouvelle écoute", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ timetable: null }) });
    const onData = vi.fn(), onError = vi.fn();
    unsubscribes.push(subscribeToActivePublishedTimetable({ user, schoolId: "school-a", schoolYearId: "year-a", onData, onError }));
    await vi.waitFor(() => expect(onData).toHaveBeenCalledWith(null));
    expect(onError).not.toHaveBeenCalled();
  });

  it("retente après une erreur sans lancer deux actualisations concurrentes", async () => {
    vi.useFakeTimers();
    const onData = vi.fn(), onError = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error("Réseau indisponible"));
    let finish: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    unsubscribes.push(subscribeToActivePublishedTimetable({ user, schoolId: "school-a", schoolYearId: "year-a", onData, onError }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish?.({ ok: true, json: async () => ({ timetable: null }) });
    await vi.waitFor(() => expect(onData).toHaveBeenCalledWith(null));
  });

  it("refuse localement un rôle ou une école divergente", () => {
    expect(() => subscribeToActivePublishedTimetable({ user: { ...user, schoolId: "school-b" }, schoolId: "school-a", schoolYearId: "year-a", onData: vi.fn(), onError: vi.fn() })).toThrow();
    expect(() => subscribeToActivePublishedTimetable({ user: { ...user, role: "cashier" }, schoolId: "school-a", schoolYearId: "year-a", onData: vi.fn(), onError: vi.fn() })).toThrow();
    for (const role of ["school_admin", "secretary", "discipline_director", "study_director", "teacher"] as const) expect(canReadPublishedTimetable({ ...user, role })).toBe(true);
    expect(canReadPublishedTimetable({ ...user, status: "inactive" })).toBe(false);
  });
});
