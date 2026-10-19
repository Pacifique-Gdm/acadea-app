import { describe, expect, it } from "vitest";
import { applicableGradingConfig, gradingSlotConfigId, type CourseGradingConfig } from "./teacherGrading";

const scoped = { schoolId: "school", schoolYearId: "2027-2028", classId: "school__year__3e::sciences", subjectId: "math" };
const legacy = { ...scoped, id: "legacy", maxScore: 20 } as CourseGradingConfig;
const specific = { ...scoped, id: "specific", gradingSlot: "period_2", maxScore: 30 } as CourseGradingConfig;

describe("maximum par cours et par évaluation", () => {
  it("donne priorité au maximum de la période puis au maximum global historique", () => {
    expect(applicableGradingConfig([legacy, specific], scoped.classId, scoped.subjectId, "period_2", scoped.schoolId, scoped.schoolYearId)?.maxScore).toBe(30);
    expect(applicableGradingConfig([legacy, specific], scoped.classId, scoped.subjectId, "period_1", scoped.schoolId, scoped.schoolYearId)?.maxScore).toBe(20);
    expect(applicableGradingConfig([specific], scoped.classId, scoped.subjectId, "period_1", scoped.schoolId, scoped.schoolYearId)).toBeUndefined();
  });

  it("ne confond ni cours, ni école, ni année, ni identifiants contenant des séparateurs", () => {
    expect(applicableGradingConfig([specific], scoped.classId, "french", "period_2", scoped.schoolId, scoped.schoolYearId)).toBeUndefined();
    expect(applicableGradingConfig([specific], scoped.classId, scoped.subjectId, "period_2", "other-school", scoped.schoolYearId)).toBeUndefined();
    expect(applicableGradingConfig([specific], scoped.classId, scoped.subjectId, "period_2", scoped.schoolId, "other-year")).toBeUndefined();
    expect(gradingSlotConfigId(scoped, "period_1")).not.toBe(gradingSlotConfigId({ ...scoped, classId: "school__year", subjectId: "3e::sciences__math" }, "period_1"));
    expect(gradingSlotConfigId(scoped, "period_1")).not.toBe(gradingSlotConfigId(scoped, "period_2"));
  });
});
