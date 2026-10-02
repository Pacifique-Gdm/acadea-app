type StudyAssignmentCaller = { uid: string; role: string; schoolId: string };

export function saveStudyAssignments(input: {
  db: unknown;
  caller: StudyAssignmentCaller;
  body: Record<string, unknown>;
}): Promise<{ count: number }>;

export function setStudyAssignmentActive(input: {
  db: unknown;
  caller: StudyAssignmentCaller;
  body: Record<string, unknown>;
}): Promise<{ active: boolean }>;
