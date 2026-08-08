import { describe, expect, it } from "vitest";
import {
  classifyValveAttachmentReference,
  isCanonicalValveAttachmentPath,
  isFirebaseStorageDownloadUrl,
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

  it("reconnaît uniquement le chemin canonique du tenant", () => {
    const path = "valves/school-a/year-a/valve-a/123e4567-e89b-42d3-a456-426614174000.pdf";
    expect(isCanonicalValveAttachmentPath(path, "school-a", "year-a", "valve-a")).toBe(true);
    expect(isCanonicalValveAttachmentPath(path, "school-b", "year-a", "valve-a")).toBe(false);
  });

  it("associe strictement l'URL Firebase au chemin Storage", () => {
    const path = "valves/school-a/year-a/valve-a/123e4567-e89b-42d3-a456-426614174000.pdf";
    const url = `https://firebasestorage.googleapis.com/v0/b/acadea-staging.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=test`;
    expect(isFirebaseStorageDownloadUrl(url, path)).toBe(true);
    expect(isFirebaseStorageDownloadUrl(url, path.replace("school-a", "school-b"))).toBe(false);
    expect(classifyValveAttachmentReference({ path, url }, { schoolId: "school-a", schoolYearId: "year-a", publicationId: "valve-a" })).toBe("internal");
  });

  it.each(["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "http://example.test/file.pdf", "not-an-url"])("bloque le lien actif ou non sûr %s", (url) => {
    expect(classifyValveAttachmentReference({ url })).toBe("blocked");
  });

  it("distingue les anciens liens Firebase et externes HTTPS", () => {
    expect(classifyValveAttachmentReference({ url: "https://firebasestorage.googleapis.com/v0/b/acadea-staging.appspot.com/o/legacy.pdf?alt=media" })).toBe("firebase_legacy");
    expect(classifyValveAttachmentReference({ url: "https://archives.example.org/legacy.pdf" })).toBe("external_legacy");
  });
});
