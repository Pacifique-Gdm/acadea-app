function normalizeConversationSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "unknown";
}

export function createConversationId(schoolId: string, schoolYearId: string, parentId: string, threadId: string) {
  return [
    "conv",
    normalizeConversationSegment(schoolId),
    normalizeConversationSegment(schoolYearId),
    normalizeConversationSegment(parentId),
    normalizeConversationSegment(threadId),
  ].join("_");
}
