import { describe, expect, it } from "vitest";
import {
  MAX_VALVE_ATTACHMENT_SIZE,
  VALVE_ATTACHMENT_ACCEPT,
  isValveAttachmentTypeAllowed,
  validateValveAttachments,
} from "./valvesMedia";

describe("politique des pieces jointes Valves", () => {
  it.each([
    ["document.pdf", "application/pdf"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["note.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ])("autorise %s avec le MIME correspondant", (name, type) => {
    expect(isValveAttachmentTypeAllowed({ name, type })).toBe(true);
    expect(validateValveAttachments([{ name, type, size: 1024 }])).toBe("");
  });

  it.each([
    ["page.html", "text/html"],
    ["image.svg", "image/svg+xml"],
    ["script.js", "application/javascript"],
    ["programme.exe", "application/x-msdownload"],
    ["archive.zip", "application/zip"],
  ])("refuse le format actif ou executable %s", (name, type) => {
    expect(validateValveAttachments([{ name, type, size: 1024 }])).not.toBe("");
  });

  it("refuse une extension et un MIME incoherents", () => {
    expect(validateValveAttachments([{ name: "faux.pdf", type: "image/png", size: 1024 }])).not.toBe("");
  });

  it("refuse un fichier vide ou superieur a 10 Mo", () => {
    expect(validateValveAttachments([{ name: "vide.pdf", type: "application/pdf", size: 0 }])).not.toBe("");
    expect(validateValveAttachments([{ name: "lourd.pdf", type: "application/pdf", size: MAX_VALVE_ATTACHMENT_SIZE + 1 }])).not.toBe("");
  });

  it("expose la whitelist exacte au champ fichier", () => {
    expect(VALVE_ATTACHMENT_ACCEPT).toBe(".pdf,.jpg,.jpeg,.png,.docx");
  });
});
