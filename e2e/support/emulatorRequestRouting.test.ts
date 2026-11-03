import { describe, expect, it } from "vitest";
import { isEmulatorSharedModuleRequest } from "./emulatorRequestRouting";

describe("emulator routing preserves Vite modules without bypassing API handlers", () => {
  it("loads the shared social-support calculation module used before login", () => {
    expect(isEmulatorSharedModuleRequest("GET", "script", "/api/_lib/socialSupportMath.js")).toBe(true);
  });
  it.each([
    ["POST", "fetch", "/api/manage-financial-transaction"],
    ["GET", "fetch", "/api/_lib/socialSupportMath.js"],
    ["POST", "script", "/api/_lib/socialSupportMath.js"],
    ["GET", "script", "/api/manage-financial-transaction"],
    ["GET", "script", "/api/_lib-not-a-module/file.js"],
  ])("keeps %s %s %s under the existing API interception", (method, resourceType, pathname) => {
    expect(isEmulatorSharedModuleRequest(method, resourceType, pathname)).toBe(false);
  });
});
