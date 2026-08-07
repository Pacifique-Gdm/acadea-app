import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("formulaire Élève partagé", () => {
  const form = readFileSync(new URL("./StudentForm.tsx", import.meta.url), "utf8");
  const upload = readFileSync(new URL("../ui/ImageUploadField.tsx", import.meta.url), "utf8");
  it("partage la photo pleine largeur et rapproche l'UID de son champ", () => {
    expect(upload).toContain("secondary-button w-full cursor-pointer justify-center");
    expect(form).toContain('className="flex min-w-0 items-center gap-3 text-sm font-medium text-slate-700"');
    expect(form).toContain('>UID</span><input className="input min-w-0 flex-1"');
  });
});
