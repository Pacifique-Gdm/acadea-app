export const MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE = 10 * 1024 * 1024;
export const MAX_MESSAGE_ATTACHMENTS = 10;
export const MESSAGE_ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx";

const policy = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

export function messageAttachmentExtension(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function validateMessageAttachments(files: Array<Pick<File, "name" | "type" | "size">>) {
  if (files.length > MAX_MESSAGE_ATTACHMENTS) return `Vous pouvez joindre au maximum ${MAX_MESSAGE_ATTACHMENTS} fichiers.`;
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE) {
    return "La taille totale des pièces jointes ne doit pas dépasser 10 Mo.";
  }
  for (const file of files) {
    const extension = messageAttachmentExtension(file.name);
    if (!policy.has(extension) || policy.get(extension) !== file.type || file.size <= 0) return `${file.name} n'est pas un fichier autorisé.`;
  }
  return "";
}

export function formatMessageAttachmentSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
