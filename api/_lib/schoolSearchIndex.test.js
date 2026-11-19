import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeSearchText,
  readSchoolSearchEntries,
  schoolSearchEntry,
  schoolSearchEntryChanged,
  schoolSearchPart,
  searchSchoolEntries,
} from "./schoolSearchIndex.js";

const vectors = JSON.parse(readFileSync(new URL("./schoolSearchIndex.vectors.json", import.meta.url), "utf8"));

const school = (id, name, extra = {}) => ({ id, ...schoolSearchEntry({ name, status: "active", schoolType: "Primaire", createdAt: "2026-09-01T00:00:00.000Z", ...extra }) });
const entries = [
  school("a", "C.S LUMBULA", { acronym: "CSL", address: "Commune de Lemba, Kinshasa", email: "contact@cs-lumbula.cd" }),
  school("b", "Institut Mpangu", { address: "Matete", email: "info@mpangu.org", status: "suspended", schoolType: "Secondaire", createdAt: "2026-10-01T00:00:00.000Z" }),
  school("c", "École Élégance", { address: "Ngaliema, Kinshasa", createdAt: "2026-08-01T00:00:00.000Z" }),
];
const names = (result) => result.schools.map((row) => row.name);

describe("lot SA-2 : liste de recherche des écoles", () => {
  it("simplifie le texte comme prévu (mêmes exemples que le déclencheur)", () => {
    for (const [input, expected] of vectors.normalize) expect(normalizeSearchText(input)).toBe(expected);
    for (const [id, part] of vectors.parts) expect(schoolSearchPart(id)).toBe(part);
    expect(schoolSearchEntry(vectors.entry.school)).toEqual(vectors.entry.expected);
  });

  it("« lumbula », « LUMBULA », « Lumbula », « Lumbulá » trouvent « C.S LUMBULA »", () => {
    for (const query of ["lumbula", "LUMBULA", "Lumbula", "Lumbulá"]) expect(names(searchSchoolEntries(entries, { query }))).toEqual(["C.S LUMBULA"]);
  });

  it("« bula » (milieu d'un mot), « c.s lumbula » et « cslumbula » la trouvent aussi", () => {
    for (const query of ["bula", "c.s lumbula", "CS Lumbula", "cslumbula", "cs-lumbula"]) expect(names(searchSchoolEntries(entries, { query }))).toEqual(["C.S LUMBULA"]);
  });

  it("cherche aussi dans la ville ou la commune et dans l'e-mail", () => {
    expect(names(searchSchoolEntries(entries, { query: "kinshasa" }))).toEqual(["C.S LUMBULA", "École Élégance"]);
    expect(names(searchSchoolEntries(entries, { query: "lemba" }))).toEqual(["C.S LUMBULA"]);
    expect(names(searchSchoolEntries(entries, { query: "info@mpangu" }))).toEqual(["Institut Mpangu"]);
    expect(names(searchSchoolEntries(entries, { query: "pangu" }))).toEqual(["Institut Mpangu"]);
  });

  it("une faute de frappe ne trouve rien ; une seule lettre ne filtre pas", () => {
    expect(searchSchoolEntries(entries, { query: "lumbla" }).total).toBe(0);
    expect(searchSchoolEntries(entries, { query: "l" }).total).toBe(3);
  });

  it("applique statut, type, tri et pages", () => {
    expect(names(searchSchoolEntries(entries, { status: "suspended" }))).toEqual(["Institut Mpangu"]);
    expect(names(searchSchoolEntries(entries, { schoolType: "Primaire" }))).toEqual(["C.S LUMBULA", "École Élégance"]);
    expect(names(searchSchoolEntries(entries, { sort: "recent" }))).toEqual(["Institut Mpangu", "C.S LUMBULA", "École Élégance"]);
    const withUsers = entries.map((row, index) => ({ ...row, u: [3, 10, 5][index] }));
    expect(names(searchSchoolEntries(withUsers, { sort: "users" }))).toEqual(["Institut Mpangu", "École Élégance", "C.S LUMBULA"]);
    const page = searchSchoolEntries(entries, { page: 1, pageSize: 2 });
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(names(page)).toEqual(["Institut Mpangu"]);
  });

  it("n'inclut pas les écoles supprimées ou en cours de suppression", () => {
    expect(schoolSearchEntry({ name: "X", status: "deleted" })).toBeNull();
    expect(schoolSearchEntry({ name: "X", status: "deleting" })).toBeNull();
    expect(schoolSearchEntryChanged({ name: "X", status: "active" }, { name: "X", status: "deleting" })).toBe(true);
    expect(schoolSearchEntryChanged({ name: "X", status: "active", phone: "1" }, { name: "X", status: "active", phone: "2" })).toBe(false);
  });

  it("lit toutes les parties ; null tant que la liste n'existe pas", async () => {
    const db = (docs) => ({ collection: () => ({ get: async () => ({ empty: docs.length === 0, docs: docs.map((data) => ({ data: () => data })) }) }) });
    expect(await readSchoolSearchEntries(db([]))).toBeNull();
    const read = await readSchoolSearchEntries(db([{ entries: { a: entries[0] } }, { entries: { b: entries[1], bad: { name: "sans texte" } } }]));
    expect(read.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
