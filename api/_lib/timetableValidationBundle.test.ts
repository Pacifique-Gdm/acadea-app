import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("garde le bundle serveur de validation synchronisé avec les règles TypeScript", () => {
  const result = spawnSync(process.execPath, ["scripts/generateTimetableValidationBundle.cjs", "--check"], {
    cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
});
