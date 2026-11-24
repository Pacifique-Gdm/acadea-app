import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ParentProfile, Student, ValvePublication } from "../types";
import { getValvePublicationParents, parentCanViewValvePublication } from "./valves";

const publication = (patch: Partial<ValvePublication>) => ({ id: "v1", schoolId: "s1", schoolYearId: "y1", title: "Réunion", kind: "communique", visibility: "all_parents", body: "…", authorId: "a", authorName: "A", createdAt: "2026-11-24", ...patch }) as ValvePublication;
const parent = (id: string, studentIds: string[]) => ({ id, studentIds } as unknown as ParentProfile);
const student = (id: string, parentId: string, className: string, status?: Student["status"]) => ({ id, parentId, className, schoolId: "s1", status } as unknown as Student);

describe("Valves : chaque publication n'arrive que chez les bonnes personnes", () => {
  const parents = [parent("p-actif", ["e1"]), parent("p-transfere", ["e2"]), parent("p-decede", ["e3"])];
  const students = [student("e1", "p-actif", "1ère"), student("e2", "p-transfere", "1ère", "TRANSFERRED"), student("e3", "p-decede", "1ère", "DECEASED")];

  it("publication pour une classe : un enfant transféré ou décédé ne compte plus", () => {
    const forClass = publication({ visibility: "class", targetClassKey: "1ère" });
    expect(parentCanViewValvePublication(forClass, parents[0], students)).toBe(true);
    expect(parentCanViewValvePublication(forClass, parents[1], students)).toBe(false);
    expect(parentCanViewValvePublication(forClass, parents[2], students)).toBe(false);
  });

  it("notification « tous les parents » : seulement les parents qui ont encore un enfant inscrit", () => {
    expect(getValvePublicationParents(publication({}), parents, students).map((item) => item.id)).toEqual(["p-actif"]);
  });

  it("un enfant d'une autre école ne rend pas un parent destinataire", () => {
    const other = [student("e9", "p-transfere", "1ère")].map((item) => ({ ...item, schoolId: "s2" }));
    expect(getValvePublicationParents(publication({}), parents, [...students, ...other]).map((item) => item.id)).toEqual(["p-actif"]);
  });

  it("le parent ne charge que les Valves de l'année affichée (plus toutes les années de l'école)", () => {
    const source = readFileSync(new URL("../services/firestoreData.ts", import.meta.url), "utf8");
    const parentBlock = source.slice(source.indexOf('if (user.role === "parent") {'), source.indexOf("return scopedData;", source.indexOf('if (user.role === "parent") {')));
    expect(parentBlock).toContain('loadCollection<AppData["valves"][number]>("valves", annualFilter)');
    expect(parentBlock).not.toContain('("valves", schoolFilter)');
  });
});

describe("Valves : compression des photos PNG", () => {
  it("une grosse photo PNG passe en JPEG seulement si le gain est net (mesuré : 3,74 Mo en PNG, 0,28 Mo en JPEG)", async () => {
    const { shouldConvertPngToJpeg, jpegFileName, PNG_TO_JPEG_THRESHOLD, isValveAttachmentTypeAllowed } = await import("./valvesMedia");
    expect(PNG_TO_JPEG_THRESHOLD).toBe(1024 * 1024);
    expect(shouldConvertPngToJpeg(3_920_000, 294_000)).toBe(true);
    expect(shouldConvertPngToJpeg(1_200_000, 900_000)).toBe(false); // gain trop faible : le PNG est gardé
    expect(jpegFileName("Affiche réunion.PNG")).toBe("Affiche réunion.jpg");
    expect(isValveAttachmentTypeAllowed({ name: jpegFileName("photo.png"), type: "image/jpeg" })).toBe(true); // accepté par l'écran et les règles
  });
});
