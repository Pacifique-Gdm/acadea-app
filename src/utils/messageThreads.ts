import type { Message } from "../types";

export function messageConversationScope(message: Pick<Message, "recipientParentId" | "threadParentId">) {
  if (message.recipientParentId === "all") return "all";
  const parentId = message.threadParentId ?? (message.recipientParentId !== "school" ? message.recipientParentId : undefined);
  return parentId ? `parent:${parentId}` : "school";
}

export function targetConversationScope(recipientParentId: Message["recipientParentId"], threadParentId?: string) {
  return messageConversationScope({ recipientParentId, threadParentId });
}

export function nextMessageThreadId(
  messages: Message[],
  senderId: string,
  recipientParentId: Message["recipientParentId"],
  threadParentId: string | undefined,
  preferredThreadId: string | undefined,
  createId: (prefix: string) => string,
) {
  const scope = targetConversationScope(recipientParentId, threadParentId);
  const scopedMessages = messages.filter((message) => messageConversationScope(message) === scope);
  const threadGroups = scopedMessages.reduce<Record<string, Message[]>>((groups, message) => {
    const key = message.threadId ?? "legacy";
    return { ...groups, [key]: [...(groups[key] ?? []), message] };
  }, {});
  const selectedMessages = preferredThreadId ? threadGroups[preferredThreadId] ?? [] : [];
  const activeMessages = selectedMessages.length
    ? selectedMessages
    : Object.values(threadGroups).sort((a, b) => {
        const lastA = [...a].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt ?? "";
        const lastB = [...b].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt ?? "";
        return lastB.localeCompare(lastA);
      })[0] ?? [];
  const lastMessages = [...activeMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-2);
  if (lastMessages.length >= 2 && lastMessages.every((message) => message.senderId === senderId)) {
    return createId("thread");
  }
  if (preferredThreadId) return preferredThreadId;
  return activeMessages[0]?.threadId;
}
