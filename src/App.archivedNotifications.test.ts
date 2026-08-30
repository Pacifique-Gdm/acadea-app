import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Exercise the actual App handler without mounting unrelated portal listeners.
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const handler = app.slice(app.indexOf("  function markNotificationsRead("), app.indexOf("  function openNotifications("));
const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

describe.each([false, true])("notifications des archives — coordination=%s", (coordinated) => {
  it.each(["archived", "draft", "active"])("respecte le verrou annuel %s avant toute mutation", (status) => {
    const updateData = vi.fn();
    const persist = vi.fn().mockResolvedValue(1);
    const currentSchool = { id: "school", ...(coordinated ? { activeCoordinationId: "coord" } : {}) };
    const run = new Function("user", "currentYear", "updateData", "markNotificationsReadTargeted", "data", "currentSchool", `${compiled}\nreturn markNotificationsRead;`)(
      { id: "admin", role: "school_admin" }, { id: "year", status }, updateData, persist,
      { notifications: [{ id: "notification", schoolId: "school", schoolYearId: "year", read: false }] }, currentSchool,
    ) as (notificationId?: string) => void;
    run();
    if (status === "active") {
      expect(persist).toHaveBeenCalledOnce();
      expect(updateData).toHaveBeenCalledOnce();
    } else {
      expect(persist).not.toHaveBeenCalled();
      expect(updateData).not.toHaveBeenCalled();
    }
  });
});
