import { beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ currentUser: { uid: "fixture", getIdToken: async () => "fake-test-token" } }));
vi.mock("../firebase", () => ({ auth: session, firebaseConfig: { projectId: "demo-acadea" } }));
import { conditionalFirestoreWrite, firestoreValue } from "./conditionalFirestoreWrite";

describe("conditional client writes", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it("serializes plain persisted data without losing zeros, nulls or arrays", () => {
    expect(firestoreValue({ id: "legacy-12345678", amount: 0, value: 1.5, enabled: false, items: [null, "a"] })).toEqual({ mapValue: { fields: {
      id: { stringValue: "legacy-12345678" }, amount: { integerValue: "0" }, value: { doubleValue: 1.5 }, enabled: { booleanValue: false },
      items: { arrayValue: { values: [{ nullValue: null }, { stringValue: "a" }] } },
    } } });
    expect(() => firestoreValue({ bad: undefined })).toThrow();
  });
  it("sends an absence precondition and never retries a collision with another ID", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), { status: 409 }));
    await expect(conditionalFirestoreWrite("valves", "valve-12345678", { id: "valve-12345678" }, false)).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    expect(request).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.writes[0].currentDocument).toEqual({ exists: false });
    expect(body.writes[0].update.name).toBe("projects/demo-acadea/databases/(default)/documents/valves/valve-12345678");
  });
  it("does not replay an uncertain network result", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network lost"));
    await expect(conditionalFirestoreWrite("valves", "fixture", { id: "fixture" }, false)).rejects.toThrow("Network lost");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
