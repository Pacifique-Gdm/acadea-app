import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ token: vi.fn(), list: vi.fn(), transition: vi.fn(), auth: { currentUser: { uid: "user-a" } } }));
vi.mock("../firebase", () => ({ auth: mocks.auth }));
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: mocks.token }));
vi.mock("./offlineQueue", () => ({ listOfflineOperations: mocks.list, transitionOfflineOperation: mocks.transition }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));
import { syncOfflineOperations } from "./offlineSync";

const scope = { userId: "user-a", schoolId: "school-a", schoolYearId: "year-a" };
const base = { id: "0d07b52b-e983-4966-88dc-95a50661796d", scope, createdAt: "2026-10-28T10:00:00Z",
  expiresAt: "2099-10-28T10:00:00Z", status: "LOCAL_PENDING", attempts: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("navigator", { onLine: true });
  mocks.auth.currentUser.uid = "user-a";
  mocks.token.mockResolvedValue("fresh-firebase-token");
  mocks.transition.mockResolvedValue(undefined);
});

describe("rejeu sécurisé des opérations locales", () => {
  it("synchronise une cote et confirme seulement après l'accusé serveur", async () => {
    mocks.list.mockResolvedValue([{ ...base, kind: "grade", payload: { assignmentId: "a", classId: "c", subjectId: "m", studentId: "p", gradingSlot: "period_1", status: "graded", score: 12, maximumAtCapture: 20, expectedMaximumVersion: "1:4", expectedGradeVersion: null } }]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, gradeId: "grade-a" }), { status: 200 }));
    await syncOfflineOperations(scope);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/manage-teacher-grading");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer fresh-firebase-token" });
    expect(mocks.transition.mock.calls.map((call) => call[2])).toEqual(["SYNCING", "SERVER_CONFIRMED"]);
  });

  it("conserve un conflit sans confirmer ni écraser la cote", async () => {
    mocks.list.mockResolvedValue([{ ...base, kind: "grade", payload: { studentId: "p" } }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "offline-conflict", error: "Maximum modifié" }), { status: 409 }));
    await syncOfflineOperations(scope);
    expect(mocks.transition.mock.calls.map((call) => call[2])).toEqual(["SYNCING", "CONFLICT"]);
  });

  it("réessaie avec le même identifiant après une interruption réseau", async () => {
    mocks.list.mockResolvedValue([{ ...base, kind: "attendance", status: "SYNCING", payload: { studentId: "p", attendanceDate: "2026-10-28", status: "absent", manualReason: "Test", expectedAttendanceVersion: null } }]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await syncOfflineOperations(scope);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { operationId: string };
    expect(request.operationId).toBe(base.id);
    expect(mocks.transition.mock.calls.map((call) => call[2])).toEqual(["RETRYABLE_ERROR", "SYNCING", "RETRYABLE_ERROR"]);
  });

  it("n'envoie pas une proposition de paiement d'un autre compte", async () => {
    mocks.auth.currentUser.uid = "other-user";
    mocks.list.mockResolvedValue([{ ...base, kind: "payment_proposal", payload: { studentId: "p", feeTypeId: "f", amount: 50, currency: "CDF", expectedFeeAmount: 100 } }]);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await syncOfflineOperations(scope);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse un accusé de paiement incomplet et ne fabrique pas de reçu", async () => {
    mocks.list.mockResolvedValue([{ ...base, kind: "payment_proposal", payload: { studentId: "p", feeTypeId: "f", amount: 50, currency: "CDF", expectedFeeAmount: 100 } }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ payment: { id: "payment-a" } }), { status: 200 }));
    await syncOfflineOperations(scope);
    expect(mocks.transition.mock.calls.map((call) => call[2])).toEqual(["SYNCING", "RETRYABLE_ERROR"]);
  });

  it("confirme un paiement seulement avec reçu et périmètre serveur concordants", async () => {
    mocks.list.mockResolvedValue([{ ...base, kind: "payment_proposal", payload: { studentId: "student-a", feeTypeId: "fee-a", amount: 50, currency: "CDF", expectedFeeAmount: 100 } }]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ payment: {
      id: "payment-a", receiptNumber: "2026-0001", schoolId: "school-a", schoolYearId: "year-a",
      studentId: "student-a", currency: "CDF",
    } }), { status: 200 }));
    await syncOfflineOperations(scope);
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(request).toMatchObject({ expectedCurrency: "CDF", expectedFeeAmount: 100, clientRequestId: base.id });
    expect(mocks.transition.mock.calls.map((call) => call[2])).toEqual(["SYNCING", "SERVER_CONFIRMED"]);
  });

  it("envoie une inscription avec identifiant déterministe et confirme son accusé", async () => {
    mocks.list.mockResolvedValue([{ ...base, kind: "student_enrollment", payload: {
      nom: "Fictif", postnom: "Test", prenom: "Alice", sexe: "F", birthDate: "2015-04-05",
      classId: "class-a", className: "Classe A",
    } }]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ student: {
      id: `student-${base.id}`,
    } }), { status: 200 }));
    await syncOfflineOperations(scope);
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { student: { id: string }; offlineOperationId: string };
    expect(request.student.id).toBe(`student-${base.id}`);
    expect(request.offlineOperationId).toBe(base.id);
    expect(mocks.transition.mock.calls.map((call) => call[2])).toEqual(["SYNCING", "SERVER_CONFIRMED"]);
  });
});
