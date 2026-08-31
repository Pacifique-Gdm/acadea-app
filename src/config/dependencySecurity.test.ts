import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type LockEntry = { version?: string };
type PackageLock = { packages: Record<string, LockEntry> };

const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8")) as PackageLock;

const version = (path: string) => lock.packages[path]?.version;

describe("correctifs transitifs de sécurité Vercel", () => {
  it("verrouille uniquement des versions corrigées pour les advisories détectées", () => {
    expect(version("node_modules/path-to-regexp")).toBe("8.4.0");
    expect(version("node_modules/@vercel/node/node_modules/path-to-regexp")).toBe("6.3.0");
    expect(version("node_modules/@vercel/remix-builder/node_modules/path-to-regexp")).toBe("6.3.0");
    expect(version("node_modules/@vercel/static-config/node_modules/ajv")).toBe("8.18.0");
    expect(version("node_modules/smol-toml")).toBe("1.6.1");
    expect(version("node_modules/@vercel/fun/node_modules/@tootallnate/once")).toBeUndefined();
    expect(version("node_modules/@tootallnate/once")).toBe("2.0.1");
    expect(version("node_modules/@vercel/node/node_modules/undici")).toBeUndefined();
    expect(version("node_modules/undici")).toBe("5.29.0");
  });

  it("conserve la compilation des routes Vercel en path-to-regexp 6 et 8", () => {
    const v8 = require("path-to-regexp") as { match: (path: string) => (value: string) => false | object };
    const v6 = require("@vercel/node/node_modules/path-to-regexp") as { pathToRegexp: (path: string) => RegExp };
    expect(v8.match("/api/:resource/:id")("/api/messages/42")).not.toBe(false);
    expect(v6.pathToRegexp("/api/:resource/:id").test("/api/messages/42")).toBe(true);
  });

  it("valide toujours une configuration Serverless standard avec Ajv corrigé", () => {
    const validationPath = require.resolve("@vercel/static-config").replace(/index\.js$/, "validation.js");
    const { validate } = require(validationPath) as { validate: (schema: object, value: unknown) => unknown };
    expect(validate({ type: "object", required: ["runtime"], properties: { runtime: { type: "string" } } }, { runtime: "nodejs22.x" })).toEqual({ runtime: "nodejs22.x" });
  });

  it("déduplique le tsx Vercel corrigé sans conserver esbuild 0.27.7", () => {
    expect(version("node_modules/tsx")).toBe("4.22.4");
    expect(version("node_modules/@vercel/backends/node_modules/tsx")).toBeUndefined();
    expect(version("node_modules/@vercel/backends/node_modules/esbuild")).toBeUndefined();
  });
});
