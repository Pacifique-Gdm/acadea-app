import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

describe("Types de frais", () => {
  it("refuse explicitement les doublons normalisés et les doubles soumissions", () => {
    expect(source).toContain("feeTypeBusinessKey");
    expect(source).toContain("Ce type de frais existe déjà pour cette classe.");
    expect(source).toContain("if (feeSubmittingRef.current");
    expect(source).toContain("disabled={feeClassNames.length === 0 || feeSubmitting}");
  });

  it("ramène le formulaire d'édition dans la zone visible et place le focus", () => {
    expect(source).toContain('setShowNewFeeForm(false)');
    expect(source).toContain('feeEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })');
    expect(source).toContain('feeNameSelectRef.current?.focus({ preventScroll: true })');
    expect(source).toContain('setFeeName(fee.name)');
    expect(source).toContain('setFeeAmount(String(fee.amount))');
  });
});
