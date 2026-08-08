import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE, validateMessageAttachments } from "./messageAttachments";

function file(name: string, type: string, size: number) {
  return { name, type, size } as File;
}

describe("pièces jointes des messages", () => {
  it("accepte une ou plusieurs pièces dont le cumul vaut exactement 10 Mo", () => {
    expect(validateMessageAttachments([file("a.pdf", "application/pdf", 5 * 1024 * 1024), file("b.pdf", "application/pdf", 5 * 1024 * 1024)])).toBe("");
    expect(MAX_MESSAGE_ATTACHMENTS_TOTAL_SIZE).toBe(10 * 1024 * 1024);
  });

  it("refuse un cumul supérieur à 10 Mo", () => {
    expect(validateMessageAttachments([file("a.pdf", "application/pdf", 6 * 1024 * 1024), file("b.png", "image/png", 6 * 1024 * 1024)])).toContain("10 Mo");
  });

  it.each([["page.html", "text/html"], ["dessin.svg", "image/svg+xml"], ["script.js", "application/javascript"], ["faux.pdf", "image/png"]])("refuse %s avec le MIME %s", (name, type) => {
    expect(validateMessageAttachments([file(name, type, 1024)])).not.toBe("");
  });
});
