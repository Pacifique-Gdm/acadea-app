import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot 9 : image de l'écran de connexion. Lecture publique ; écriture par le Super administrateur seulement.
const mocks = vi.hoisted(() => ({
  caller: { uid: "super-test", role: "super_admin" } as { uid: string; role: string },
  store: {} as Record<string, Record<string, unknown> | undefined>,
  writes: [] as string[],
  failRead: false,
}));
vi.mock("./_lib/activeUser.js", () => ({ verifyActorIdToken: async () => mocks.caller, requireActiveApiUser: async () => mocks.caller }));
vi.mock("./_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { SCHOOL_ADMIN: {}, SCHOOL_DELETE: {}, MESSAGE_RECIPIENTS: {} }, enforceApiRateLimit: async () => undefined, sendRateLimitError: () => false }));
vi.mock("./_lib/firebaseAdmin.js", () => ({
  firebaseAdminPublicError: (error: Error) => ({ message: error.message, code: "internal" }),
  initAdmin: () => ({
    auth: {},
    bucket: {},
    db: {
      doc: (path: string) => ({
        get: async () => {
          if (mocks.failRead) throw new Error("Firestore indisponible");
          const data = mocks.store[path];
          return { exists: Boolean(data), data: () => data };
        },
        set: async (data: Record<string, unknown>) => { mocks.writes.push(path); mocks.store[path] = data; },
      }),
    },
  }),
}));

import handler from "./manage-school.js";
import { LOGIN_IMAGE_RESET_CONFIRMATION, LOGIN_IMAGE_SAVE_CONFIRMATION, resetLoginImageCacheForTests } from "./_lib/loginImage.js";

const SMALL_IMAGE = `data:image/webp;base64,${Buffer.alloc(2_000, 7).toString("base64")}`;
const HEAVY_IMAGE = `data:image/jpeg;base64,${Buffer.alloc(101 * 1024, 7).toString("base64")}`;

function fakeRes() {
  let payload = "";
  const headers: Record<string, string> = {};
  const res = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; }, end: (value: string) => { payload = value; } };
  return { res, read: () => ({ status: res.statusCode, headers, body: JSON.parse(payload) as Record<string, unknown> }) };
}

async function post(body: Record<string, unknown>) {
  const { res, read } = fakeRes();
  await handler({ method: "POST", headers: { authorization: "Bearer e2e-token" }, body } as never, res as never);
  return read();
}

async function publicGet(url = "/api/manage-school?action=login-image") {
  const { res, read } = fakeRes();
  await handler({ method: "GET", url, headers: {} } as never, res as never);
  return read();
}

describe("API de l'image de connexion (lot 9)", () => {
  beforeEach(() => {
    mocks.caller = { uid: "super-test", role: "super_admin" };
    mocks.store = {};
    mocks.writes = [];
    mocks.failRead = false;
    resetLoginImageCacheForTests();
  });

  it("sans image enregistrée, la lecture publique renvoie une image vide (photo d'origine gardée)", async () => {
    const response = await publicGet();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ imageDataUrl: "", updatedAt: "" });
    expect(response.headers["Cache-Control"]).toContain("s-maxage=60");
  });

  it("le Super administrateur enregistre une image, puis tout le monde la lit sans connexion", async () => {
    const saved = await post({ action: "login-image-save", mode: "save", imageDataUrl: SMALL_IMAGE, confirmation: LOGIN_IMAGE_SAVE_CONFIRMATION });
    expect(saved.status).toBe(200);
    expect((saved.body.image as { imageDataUrl: string }).imageDataUrl).toBe(SMALL_IMAGE);
    expect(mocks.writes).toEqual(["platform/loginImage"]);
    expect(mocks.store["platform/loginImage"]).toMatchObject({ imageDataUrl: SMALL_IMAGE, updatedBy: "super-test" });
    resetLoginImageCacheForTests();
    const read = await publicGet();
    expect(read.body.imageDataUrl).toBe(SMALL_IMAGE);
    // Rien d'autre n'est rendu public (ni l'auteur).
    expect(Object.keys(read.body).sort()).toEqual(["imageDataUrl", "updatedAt"]);
  });

  it("retour à l'image d'origine", async () => {
    mocks.store["platform/loginImage"] = { imageDataUrl: SMALL_IMAGE, updatedAt: "2026-11-27T10:00:00.000Z" };
    const reset = await post({ action: "login-image-save", mode: "reset", confirmation: LOGIN_IMAGE_RESET_CONFIRMATION });
    expect(reset.status).toBe(200);
    expect(reset.body.image).toEqual({ imageDataUrl: "", updatedAt: "" });
    expect((await publicGet()).body.imageDataUrl).toBe("");
  });

  it("refuse tous les autres rôles, sans rien écrire", async () => {
    for (const role of ["school_admin", "cashier", "coordination_admin", "sub_coordination_admin", "teacher", "parent", "secretary", "prefect"]) {
      mocks.caller = { uid: `${role}-test`, role };
      const response = await post({ action: "login-image-save", mode: "save", imageDataUrl: SMALL_IMAGE, confirmation: LOGIN_IMAGE_SAVE_CONFIRMATION });
      expect(response.status).toBe(403);
    }
    expect(mocks.writes).toEqual([]);
  });

  it("refuse une image trop lourde, un mauvais format ou une confirmation absente", async () => {
    expect((await post({ action: "login-image-save", mode: "save", imageDataUrl: HEAVY_IMAGE, confirmation: LOGIN_IMAGE_SAVE_CONFIRMATION })).status).toBe(400);
    expect((await post({ action: "login-image-save", mode: "save", imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=", confirmation: LOGIN_IMAGE_SAVE_CONFIRMATION })).status).toBe(400);
    expect((await post({ action: "login-image-save", mode: "save", imageDataUrl: "https://exemple.com/a.jpg", confirmation: LOGIN_IMAGE_SAVE_CONFIRMATION })).status).toBe(400);
    expect((await post({ action: "login-image-save", mode: "save", imageDataUrl: SMALL_IMAGE })).status).toBe(400);
    expect((await post({ action: "login-image-save", mode: "reset", confirmation: LOGIN_IMAGE_SAVE_CONFIRMATION })).status).toBe(400);
    expect(mocks.writes).toEqual([]);
  });

  it("une lecture publique en panne ne casse rien (503, l'écran garde son image)", async () => {
    mocks.failRead = true;
    const response = await publicGet();
    expect(response.status).toBe(503);
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  it("toute autre demande GET reste refusée", async () => {
    expect((await publicGet("/api/manage-school")).status).toBe(405);
    expect((await publicGet("/api/manage-school?action=platform-stats")).status).toBe(405);
  });
});
