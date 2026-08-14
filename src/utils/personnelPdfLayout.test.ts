import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/utils/pdf.ts", "utf8");

describe("mise en page PDF de la fiche personnel", () => {
  it("place identification et photo en deux zones et conserve le ratio", () => {
    expect(source).toContain(".personnel-identification-layout");
    expect(source).toContain("grid-template-columns: minmax(0, 1fr) 34mm");
    expect(source).toContain(".personnel-photo-box img { width: 30mm; height: 38mm; object-fit: contain; }");
  });

  it("protège observations et signatures contre les coupures incohérentes", () => {
    expect(source).toContain('".personnel-signatures"');
    expect(source).toContain(".personnel-observations { min-height: 32px;");
    expect(source).toContain("page-break-inside: avoid");
  });
});
