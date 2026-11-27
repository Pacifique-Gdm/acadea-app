import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listAllowedMessageRecipients } from "./messageRecipients.js";
import { resolveRecipients } from "../send-school-message.js";

// Lot P5 (Préfet d'études) : « Message » aux parents de SES sections seulement.
// Vérification de l'existant, sans changement de code : le serveur limite déjà la liste proposée
// ET l'envoi aux parents des sections du compte (Direction des études avec sections).
function memoryDb(values) {
  const snap = (path) => ({ exists: values.has(path), id: path.split("/").at(-1), data: () => values.get(path) });
  const query = (name, filters) => ({
    where: (key, op, value) => query(name, [...filters, [key, op, value]]),
    get: async () => ({ docs: [...values].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/").length === 2
      && filters.every(([key, op, value]) => op === "in" ? value.includes(data[key]) : data[key] === value)).map(([path]) => snap(path)) }),
  });
  return {
    doc: (path) => ({ path, get: async () => snap(path) }),
    getAll: async (...refs) => refs.map((ref) => snap(ref.path)),
    collection: (name) => query(name, []),
  };
}
const school = "school-a", year = "year-1";
function seeded() {
  const v = new Map();
  v.set(`schools/${school}`, { status: "active", activeSchoolYearId: year });
  v.set(`schoolYears/${year}`, { schoolId: school, status: "active" });
  v.set("users/prefet", { role: "study_director", studyFunction: "prefect_of_studies", schoolId: school, sectionIds: ["Primaire"], name: "Préfet" });
  v.set("users/pp", { role: "parent", schoolId: school, parentId: "parent-p", name: "Parent Primaire" });
  v.set("users/ps", { role: "parent", schoolId: school, parentId: "parent-s", name: "Parent Secondaire" });
  v.set("parents/parent-p", { schoolId: school, status: "active", studentIds: ["e1"] });
  v.set("parents/parent-s", { schoolId: school, status: "active", studentIds: ["e2"] });
  v.set("students/e1", { schoolId: school, schoolYearId: year, section: "Primaire", parentId: "parent-p" });
  v.set("students/e2", { schoolId: school, schoolYearId: year, section: "Secondaire", parentId: "parent-s" });
  return v;
}
const prefect = (values) => ({ uid: "prefet", role: "study_director", schoolId: school, profile: values.get("users/prefet") });

describe("lot P5 : messages du Préfet d'études aux parents de ses sections (vérification)", () => {
  it("la liste proposée ne contient que les parents de ses sections", async () => {
    const values = seeded();
    const recipients = await listAllowedMessageRecipients(memoryDb(values), prefect(values), year);
    const parents = recipients.filter((item) => item.role === "parent").map((item) => item.uid);
    expect(parents).toEqual(["pp"]);
  });

  it("l'envoi à un parent d'une autre section est refusé par le serveur", async () => {
    const values = seeded();
    await expect(resolveRecipients(memoryDb(values), prefect(values), ["parent"], ["ps"], year)).rejects.toMatchObject({ statusCode: 403 });
    await expect(resolveRecipients(memoryDb(values), prefect(values), ["parent"], ["pp"], year)).resolves.toHaveLength(1);
  });

  it("l'écran « Message » transmet bien l'année scolaire (sinon le serveur ne limiterait pas la liste)", () => {
    const portal = readFileSync(new URL("../../src/modules/studies/StudyDirectorPortal.tsx", import.meta.url), "utf8");
    const module = readFileSync(new URL("../../src/modules/messages/MessagesModule.tsx", import.meta.url), "utf8");
    expect(portal).toContain('drawer === "messages" && <AdminDrawer title="Message"');
    expect(module).toContain("useSchoolMessageRecipients(user, school, year.id)");
  });
});
