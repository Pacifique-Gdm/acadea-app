import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import handler from "../api/provision-school-account.js";
import { fixture, invoke } from "./support/emulatorRecipe";

test("créations de personnel et Parent confirmées sans doublon après perte de réponse", async () => {
  test.setTimeout(120_000);
  const f = fixture();
  const authIds: string[] = [];
  try {
    await f.seed(["super_admin", "school_admin", "secretary", "study_director"]);
    for (const scenario of [
      { caller: "super_admin", role: "school_admin" },
      { caller: "school_admin", role: "cashier" },
      { caller: "school_admin", role: "discipline_director" },
      { caller: "school_admin", role: "study_director" },
      { caller: "school_admin", role: "secretary" },
      { caller: "study_director", role: "teacher" },
      { caller: "secretary", role: "parent" },
    ]) {
      const clientRequestId = randomBytes(16).toString("hex");
      const body = { role: scenario.role, schoolId: f.school, schoolYearId: f.year,
        name: `Compte fictif ${scenario.role}`, email: `${f.tag}-${scenario.role}-created@example.invalid`,
        password: `LocalOnly-${randomBytes(16).toString("hex")}`, phone: "0991234567", clientRequestId };
      const token = await f.token(scenario.caller);
      const created = await invoke(handler, token, body);
      expect(created.status, `${scenario.role}: ${String(created.payload.code ?? created.payload.error ?? "unknown")}`).toBe(200);
      const result = created.payload as { user: { id: string }; parent?: { id: string } };
      authIds.push(result.user.id);
      expect((await f.db.doc(`users/${result.user.id}`).get()).exists).toBe(true);
      expect((await f.db.doc(`provisioningReceipts/${clientRequestId}`).get()).data()).toMatchObject({ schoolId: f.school, result: created.payload });
      const recovered = await invoke(handler, token, { action: "recover-creation", role: scenario.role,
        schoolId: f.school, schoolYearId: f.year, email: body.email, clientRequestId });
      expect(recovered).toEqual(created);
      const replayed = await invoke(handler, token, body);
      expect(replayed).toEqual(created);
      if (scenario.role === "parent") {
        expect((await f.db.doc(`parents/${result.parent?.id}`).get()).exists).toBe(true);
      }
      const forbidden = await invoke(handler, await f.token(scenario.caller === "secretary" ? "school_admin" : "secretary"), { action: "recover-creation", role: scenario.role,
        schoolId: f.school, schoolYearId: f.year, email: body.email, clientRequestId });
      expect(forbidden.status).toBe(scenario.caller === "secretary" ? 409 : 403);
    }
    expect((await f.db.collection("users").where("schoolId", "==", f.school).get()).size).toBe(10);
  } finally {
    for (const uid of authIds) await f.auth.deleteUser(uid).catch(() => {});
    await f.cleanup();
  }
});
