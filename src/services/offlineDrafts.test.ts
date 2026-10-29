import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureOfflineDraft, validateOfflineDraft } from "./offlineDrafts";
import { readOfflineAccess } from "./offlineAccess";
import { listOfflineOperations, queueOfflineOperation } from "./offlineQueue";

vi.mock("./offlineAccess", () => ({ readOfflineAccess: vi.fn() }));
vi.mock("./offlineQueue", () => ({ queueOfflineOperation: vi.fn(), listOfflineOperations: vi.fn() }));

const teacher = { userId: "teacher-a", role: "teacher", schoolId: "school-a", schoolName: "Fictive",
  schoolYearId: "year-a", schoolYearName: "2027-2028", verifiedAt: "2026-10-28T10:00:00Z", expiresAt: "2026-10-28T18:00:00Z" } as const;
const grade = { assignmentId: "assignment-a", classId: "class-a", subjectId: "subject-a", studentId: "student-a",
  gradingSlot: "period_1", status: "graded", score: 12, maximumAtCapture: 20,
  expectedGradeVersion: null, expectedMaximumVersion: "1793181600:123456789" } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readOfflineAccess).mockResolvedValue(teacher);
  vi.mocked(listOfflineOperations).mockResolvedValue([]);
  vi.mocked(queueOfflineOperation).mockImplementation(async (scope, kind, payload) => ({
    id: "draft-a", kind, scope, payload, createdAt: "2026-10-28T10:00:00Z", expiresAt: "2026-11-27T10:00:00Z",
    status: "LOCAL_PENDING", attempts: 0,
  }));
});

describe("préparation hors connexion sans effet serveur", () => {
  it("isole une cote et conserve les préconditions de comparaison", async () => {
    const result = await captureOfflineDraft("teacher-a", "grade", { ...grade });
    expect(result.status).toBe("LOCAL_PENDING");
    expect(result.scope).toEqual({ userId: "teacher-a", schoolId: "school-a", schoolYearId: "year-a" });
    expect(result.payload).toMatchObject({ score: 12, expectedMaximumVersion: grade.expectedMaximumVersion });
  });

  it("refuse une session expirée ou un rôle incorrect", async () => {
    vi.mocked(readOfflineAccess).mockResolvedValueOnce(null);
    await expect(captureOfflineDraft("teacher-a", "grade", { ...grade })).rejects.toThrow("Session locale");
    await expect(captureOfflineDraft("teacher-a", "payment_proposal", { studentId: "student-a", feeTypeId: "fee-a", amount: 10, currency: "CDF", expectedFeeAmount: 20 })).rejects.toThrow("rôle");
    expect(queueOfflineOperation).not.toHaveBeenCalled();
  });

  it("refuse une cote au-delà du maximum et une absence transformée en zéro", () => {
    expect(() => validateOfflineDraft("grade", { ...grade, score: 21 })).toThrow();
    expect(() => validateOfflineDraft("grade", { ...grade, status: "absent", score: 0 })).toThrow();
  });

  it("bloque une deuxième saisie en attente pour la même cote", async () => {
    vi.mocked(listOfflineOperations).mockResolvedValueOnce([{
      id: "draft-existing", kind: "grade", scope: { userId: "teacher-a", schoolId: "school-a", schoolYearId: "year-a" },
      payload: { ...grade }, status: "LOCAL_PENDING", attempts: 0,
      createdAt: "2026-10-28T10:00:00Z", expiresAt: "2026-11-27T10:00:00Z",
    }]);
    await expect(captureOfflineDraft("teacher-a", "grade", { ...grade, score: 14 })).rejects.toThrow("brouillon");
    expect(queueOfflineOperation).not.toHaveBeenCalled();
  });

  it("contrôle les présences, inscriptions et paiements provisoires", () => {
    expect(() => validateOfflineDraft("attendance", { studentId: "student-a", attendanceDate: "2026-10-28",
      status: "absent", manualReason: "Contrôle manuel", expectedAttendanceVersion: null })).not.toThrow();
    expect(() => validateOfflineDraft("student_enrollment", { nom: "Fictif", postnom: "Test", prenom: "Alice",
      sexe: "F", birthDate: "2015-04-05", classId: "class-a", className: "Classe fictive", classOptionKey: "option-a" })).not.toThrow();
    expect(() => validateOfflineDraft("payment_proposal", { studentId: "student-a", feeTypeId: "fee-a", amount: 10.5,
      currency: "CDF", expectedFeeAmount: 20 })).not.toThrow();
    expect(() => validateOfflineDraft("payment_proposal", { studentId: "student-a", feeTypeId: "fee-a", amount: 0,
      currency: "CDF", expectedFeeAmount: 20 })).toThrow();
  });
});
