import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES } from "../../utils/userFacingError";
import { ErrorNotice } from "./ErrorNotice";

/** Textes techniques interdits à l'écran. */
const FORBIDDEN = /Firebase|Firestore|auth\/|permission-denied|network-request-failed|deadline-exceeded|unauthenticated|Failed to fetch|Load failed|NetworkError|TypeError|insufficient permissions|undefined|\bnull\b/i;

const html = (error: unknown, onRetry?: () => void) => renderToStaticMarkup(createElement(ErrorNotice, { error, onRetry }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("composant d'erreur commun (ErrorNotice)", () => {
  it("n'affiche jamais un texte technique, quel que soit l'échec", () => {
    const failures: unknown[] = [
      new Error("Firebase: Error (auth/network-request-failed)."),
      new Error("Firebase: Error (auth/user-token-expired)."),
      Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }),
      new TypeError("Failed to fetch"),
      new TypeError("Load failed"),
      { code: "deadline-exceeded", message: "Deadline exceeded" },
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      "Firebase: Error (firestore/internal).",
      new Error("Chargement Firestore impossible pour users : FirebaseError: [code=unavailable]"),
    ];
    for (const failure of failures) {
      const markup = html(failure, () => undefined);
      expect(text(markup)).not.toMatch(FORBIDDEN);
      expect(Object.values(ERROR_MESSAGES).some((message) => text(markup).includes(message))).toBe(true);
    }
  });

  it("donne le bon bouton selon le type d'erreur", () => {
    const retry = () => undefined;
    expect(text(html(new Error("Firebase: Error (auth/network-request-failed)."), retry))).toBe(`${ERROR_MESSAGES.network} Réessayer`);
    expect(text(html({ code: "deadline-exceeded" }, retry))).toBe(`${ERROR_MESSAGES.timeout} Réessayer`);
    expect(text(html({ code: "unauthenticated" }, retry))).toBe(`${ERROR_MESSAGES.session} Se reconnecter`);
    expect(text(html({ code: "permission-denied" }, retry))).toBe(ERROR_MESSAGES.permission);
    expect(text(html(new Error("Firebase: Error (firestore/internal)."), retry))).toBe(`${ERROR_MESSAGES.other} Réessayer`);
  });

  it("propose « Réessayer » sur un message métier quand l'écran fournit la relance", () => {
    expect(text(html("Lecture refusée (test)", () => undefined))).toBe("Lecture refusée (test) Réessayer");
    expect(text(html({ code: "permission-denied" }, () => undefined))).toBe(ERROR_MESSAGES.permission);
  });

  it("affiche tel quel un message métier, et rien sans erreur", () => {
    expect(text(html("Le montant dépasse le reste à payer pour ce frais."))).toBe("Le montant dépasse le reste à payer pour ce frais.");
    expect(html("")).toBe("");
    expect(html(undefined)).toBe("");
  });
});

/** Fichiers de l'application (hors tests). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const root = join(__dirname, "..", "..");
const files = sourceFiles(root).map((path) => ({ path, source: readFileSync(path, "utf8") }));
const screens = files.filter(({ path }) => /[\\/](components|modules|hooks)[\\/]|App\.tsx$/.test(path));

describe("aucun message technique brut à l'écran (inventaire du code)", () => {
  it("n'affiche plus jamais `cause.message` brut", () => {
    const raw = /\b(\w+) instanceof Error ?\? ?\1\.message ?:|\bset[A-Z]\w*\((?:cause|error|err|e|reason)\.message\)|\$\{(?:cause|error|err)\.message\}|\berror: (?:cause|error)\.message\b/;
    const offenders = screens.filter(({ source }) => raw.test(source)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("n'écrit pas « Firebase » ou « Firestore » dans un message destiné à l'utilisateur", () => {
    const visible = /set[A-Z]\w*Error\(\s*["'`][^"'`]*(Firebase|Firestore)|<(p|span|div)[^>]*>[^<{]*(Firebase|Firestore)/;
    const offenders = screens.filter(({ source }) => visible.test(source)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("utilise le composant commun pour les encadrés d'erreur rouges", () => {
    const handmade = /\{(\w*[eE]rror\w*) && <p[^>]*(role="alert"|text-red)[^>]*>\{\1\}<\/p>\}/;
    const offenders = screens.filter(({ source }) => handmade.test(source)).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
