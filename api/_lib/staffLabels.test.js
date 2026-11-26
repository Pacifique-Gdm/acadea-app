import { describe, expect, it } from "vitest";
import { listStaffLabels, staffFunctionLabel, staffLabels } from "./staffLabels.js";

const users = {
  prefect: { role: "study_director", studyFunction: "prefect_of_studies", name: " Jean Kasa ", schoolId: "s", email: "jean@example.test", phone: "099" },
  director: { role: "study_director", name: "Marie Lunda", schoolId: "s" },
  discipline: { role: "discipline_director", name: "Paul", schoolId: "s" },
  parent: { role: "parent", name: "Parent", schoolId: "s" },
  outsider: { role: "study_director", name: "Autre école", schoolId: "x" },
};
const db = { doc: (path) => ({ get: async () => { const row = users[path.split("/")[1]]; return { exists: Boolean(row), data: () => row }; } }) };

describe("lot R1 : nom et fonction de l'auteur d'un réglage", () => {
  it("renvoie seulement le nom et la fonction du personnel de la même école", async () => {
    const labels = await staffLabels(db, "s", ["prefect", "director", "discipline", "parent", "outsider", "absent", "a/b", "prefect"]);
    expect(labels).toEqual({
      prefect: { name: "Jean Kasa", functionLabel: "Préfet d'études" },
      director: { name: "Marie Lunda", functionLabel: "Directeur des études" },
      discipline: { name: "Paul", functionLabel: "Directeur de discipline" },
    });
  });

  it("refuse les rôles non autorisés et une autre école", async () => {
    await expect(listStaffLabels({ db, caller: { role: "parent", schoolId: "s" }, body: { schoolId: "s", userIds: ["prefect"] } })).rejects.toMatchObject({ status: 403 });
    await expect(listStaffLabels({ db, caller: { role: "teacher", schoolId: "s" }, body: { schoolId: "s", userIds: ["prefect"] } })).rejects.toMatchObject({ status: 403 });
    await expect(listStaffLabels({ db, caller: { role: "study_director", schoolId: "x" }, body: { schoolId: "s", userIds: ["prefect"] } })).rejects.toMatchObject({ status: 403 });
    await expect(listStaffLabels({ db, caller: { role: "study_director", schoolId: "s" }, body: { schoolId: "s", userIds: Array(51).fill("a") } })).rejects.toMatchObject({ status: 400 });
    await expect(listStaffLabels({ db, caller: { role: "discipline_director", schoolId: "s" }, body: { schoolId: "s", userIds: ["director"] } })).resolves.toEqual({ labels: { director: { name: "Marie Lunda", functionLabel: "Directeur des études" } } });
  });

  it("donne la fonction affichée", () => {
    expect(staffFunctionLabel({ role: "study_director", studyFunction: "nursery_director" })).toBe("Directrice maternelle");
    expect(staffFunctionLabel({ role: "study_director" })).toBe("Directeur des études");
    expect(staffFunctionLabel({ role: "parent" })).toBeUndefined();
  });
});
