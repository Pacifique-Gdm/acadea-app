import type { Message, MessageAttachment } from "../types";
import { MAX_MESSAGE_ATTACHMENTS, MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE, messageAttachmentExtension } from "./messageAttachments";

const allowedTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

export function getDisplayableMessageAttachments(message: Message): MessageAttachment[] {
  if (!Array.isArray(message.attachments) || message.attachments.length > MAX_MESSAGE_ATTACHMENTS) return [];
  const conversationId = message.conversationId ?? message.threadId;
  if (!conversationId) return [];
  const prefix = `messages/${message.schoolId}/${conversationId}/${message.id}/`;
  let totalSize = 0;

  return message.attachments.filter((attachment) => {
    if (!attachment || typeof attachment.path !== "string" || !attachment.path.startsWith(prefix)) return false;
    const objectName = attachment.path.slice(prefix.length);
    if (!objectName || objectName.includes("/")) return false;
    const extension = messageAttachmentExtension(objectName);
    const size = Number(attachment.size);
    if (!allowedTypes.has(extension) || allowedTypes.get(extension) !== attachment.type || !Number.isFinite(size) || size <= 0) return false;
    totalSize += size;
    return totalSize <= MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE;
  });
}
