export const STUDY_SUBJECT_FEEDBACK_DURATION_MS = 4_000;

export function replaceStudySubjectFeedbackTimer(current: ReturnType<typeof setTimeout> | undefined, clearFeedback: () => void) {
  if (current) clearTimeout(current);
  return setTimeout(clearFeedback, STUDY_SUBJECT_FEEDBACK_DURATION_MS);
}
