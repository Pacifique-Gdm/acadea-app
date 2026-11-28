import { beforeEach, describe, expect, it, vi } from "vitest";

// Fond flou : copie floue de l'image de connexion, enregistrée avec elle par le Super administrateur.
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

const BLUR = `data:image/jpeg;base64,${Buffer.alloc(3_000, 9).toString("base64")}`;
const HEAVY_BLUR = `data:image/jpeg;base64,${Buffer.alloc(41 * 1024, 9).toString("base64")}`;
const save = (extra: Record<string, unknown>) => post({ action: "login-image-save", mode: "save", imageDataUrl: SMALL_IMAGE, confirmation: LOGIN_IMAGE_SAVE_CONFIRMATION, ...extra });

describe("API de l'image de connexion : copie floue (fond flou)", () => {
  beforeEach(() => {
    mocks.caller = { uid: "super-test", role: "super_admin" };
    mocks.store = {};
    mocks.writes = [];
    mocks.failRead = false;
    resetLoginImageCacheForTests();
  });

  it("enregistre la copie floue avec l'image, dans le même document, puis tout le monde la lit", async () => {
    const saved = await save({ blurDataUrl: BLUR });
    expect(saved.status).toBe(200);
    expect((saved.body.image as { blurDataUrl?: string }).blurDataUrl).toBe(BLUR);
    expect(mocks.writes).toEqual(["platform/loginImage"]);
    expect(mocks.store["platform/loginImage"]).toMatchObject({ imageDataUrl: SMALL_IMAGE, blurDataUrl: BLUR });
    resetLoginImageCacheForTests();
    const read = await publicGet();
    expect(read.body.blurDataUrl).toBe(BLUR);
    // Rien d'autre n'est rendu public (ni l'auteur).
    expect(Object.keys(read.body).sort()).toEqual(["blurDataUrl", "imageDataUrl", "updatedAt"]);
  });

  it("valeur de repli : copie floue trop lourde ou invalide → image enregistrée sans copie floue (fond d'aujourd'hui)", async () => {
    for (const blurDataUrl of [HEAVY_BLUR, "https://exemple.com/b.jpg", "data:image/svg+xml;base64,PHN2Zz4=", 42]) {
      const saved = await save({ blurDataUrl });
      expect(saved.status).toBe(200);
      expect(saved.body.image).not.toHaveProperty("blurDataUrl");
      expect(mocks.store["platform/loginImage"]).not.toHaveProperty("blurDataUrl");
    }
  });

  it("ancienne image enregistrée sans copie floue : la lecture publique reste exactement la même", async () => {
    mocks.store["platform/loginImage"] = { imageDataUrl: SMALL_IMAGE, updatedAt: "2026-11-27T10:00:00.000Z", updatedBy: "x" };
    const read = await publicGet();
    expect(read.body).toEqual({ imageDataUrl: SMALL_IMAGE, updatedAt: "2026-11-27T10:00:00.000Z" });
  });

  it("le retour à l'image d'origine efface aussi la copie floue", async () => {
    mocks.store["platform/loginImage"] = { imageDataUrl: SMALL_IMAGE, updatedAt: "2026-11-27T10:00:00.000Z", blurDataUrl: BLUR };
    const reset = await post({ action: "login-image-save", mode: "reset", confirmation: LOGIN_IMAGE_RESET_CONFIRMATION, blurDataUrl: BLUR });
    expect(reset.body.image).toEqual({ imageDataUrl: "", updatedAt: "" });
    expect(mocks.store["platform/loginImage"]).not.toHaveProperty("blurDataUrl");
    resetLoginImageCacheForTests();
    expect(await publicGet()).toMatchObject({ body: { imageDataUrl: "", updatedAt: "" } });
  });
});
