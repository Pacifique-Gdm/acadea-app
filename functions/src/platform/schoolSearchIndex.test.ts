import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSearchText, schoolSearchEntry, schoolSearchPart, schoolSearchUpdate } from "./schoolSearchIndex.js";

// Mêmes exemples que le serveur Acadéa (api/_lib/schoolSearchIndex.test.js) : les deux règles restent identiques.
const vectors = JSON.parse(readFileSync(new URL("../../../api/_lib/schoolSearchIndex.vectors.json", import.meta.url), "utf8")) as {
  normalize: [string, string][]; parts: [string, string][]; entry: { school: Record<string, unknown>; expected: Record<string, unknown> };
};

describe("lot SA-2 : déclencheur de la liste de recherche des écoles", () => {
  it("simplifie, range et décrit chaque école exactement comme le serveur", () => {
    for (const [input, expected] of vectors.normalize) expect(normalizeSearchText(input)).toBe(expected);
    for (const [id, part] of vectors.parts) expect(schoolSearchPart(id)).toBe(part);
    expect(schoolSearchEntry(vectors.entry.school)).toEqual(vectors.entry.expected);
  });

  it("n'écrit rien si la ligne de recherche ne change pas (ex. téléphone, devise)", () => {
    const school = { name: "C.S LUMBULA", status: "active" };
    expect(schoolSearchUpdate("a", school, { ...school, phone: "+243" })).toBeNull();
  });

  it("ajoute, met à jour et retire la ligne quand il le faut", () => {
    const created = schoolSearchUpdate("a", undefined, { name: "C.S LUMBULA", status: "active" });
    expect(created?.entry?.name).toBe("C.S LUMBULA");
    expect(schoolSearchUpdate("a", { name: "A", status: "active" }, { name: "B", status: "active" })?.entry?.o).toBe("b");
    expect(schoolSearchUpdate("a", { name: "A", status: "active" }, { name: "A", status: "deleting" })).toEqual({ part: schoolSearchPart("a"), entry: null });
    expect(schoolSearchUpdate("a", { name: "A", status: "active" }, undefined)).toEqual({ part: schoolSearchPart("a"), entry: null });
  });
});
