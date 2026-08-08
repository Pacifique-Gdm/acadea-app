import { describe, expect, it } from "vitest";
import { apiErrorMessage, RATE_LIMIT_MESSAGE } from "./rateLimitErrors";

describe("messages du rate limiter", () => {
  it("masque les détails internes pour HTTP 429 et resource-exhausted", () => {
    expect(apiErrorMessage(429, { error: "_rateLimits/secret", code: "resource-exhausted" }, "Erreur")).toBe(RATE_LIMIT_MESSAGE);
    expect(apiErrorMessage(400, { code: "resource-exhausted" }, "Erreur")).toBe(RATE_LIMIT_MESSAGE);
  });
});
