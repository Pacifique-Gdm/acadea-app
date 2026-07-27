import { describe, expect, it } from "vitest";
import { isInvalidTokenError } from "./cleanupInvalidTokens.js";

describe("isInvalidTokenError", () => {
  it("identifie uniquement les tokens FCM définitivement invalides", () => {
    expect(isInvalidTokenError("messaging/registration-token-not-registered")).toBe(true);
    expect(isInvalidTokenError("messaging/invalid-registration-token")).toBe(true);
    expect(isInvalidTokenError("messaging/internal-error")).toBe(false);
    expect(isInvalidTokenError()).toBe(false);
  });
});
