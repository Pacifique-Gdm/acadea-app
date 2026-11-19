import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../firebase", () => ({ db: null, firebaseReady: false }));
vi.mock("../../services/schoolMessaging", () => ({ loadPlatformRecipients: vi.fn(async () => []), sendPlatformMessage: vi.fn() }));

import { PlatformMessages } from "./PlatformMessages";
import type { AppUser } from "../../types";

const user = { id: "super-1", role: "super_admin", name: "Plateforme" } as AppUser;

describe("lot SA-6a : messagerie du Super administrateur", () => {
  it("l'onglet Messages ne montre que le formulaire « Nouveau message »", () => {
    const markup = renderToStaticMarkup(createElement(PlatformMessages, { user, schools: [], section: "compose" }));
    expect(markup).toContain("Nouveau message");
    expect(markup).not.toContain("Messages et réponses");
  });

  it("la cloche ne montre que « Messages et réponses »", () => {
    const markup = renderToStaticMarkup(createElement(PlatformMessages, { user, schools: [], section: "inbox" }));
    expect(markup).toContain("Messages et réponses");
    expect(markup).not.toContain("Nouveau message");
    expect(markup).not.toContain("Destinataires");
  });

  it("le module place chaque partie à son endroit", () => {
    const source = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
    expect(source).toContain('<MessagingDrawerShell onClose={() => setMessagingOpen(false)}><PlatformMessages user={user} schools={visibleSchools} section="inbox" /></MessagingDrawerShell>');
    expect(source).toMatch(/<KeptTab id="messages"[^>]*>\s*<PlatformMessages user=\{user\} schools=\{visibleSchools\} section="compose" \/>/);
    expect(source.match(/<PlatformMessages /g)).toHaveLength(2);
  });

  it("chaque partie ne charge que ce dont elle a besoin", () => {
    const source = readFileSync(new URL("./PlatformMessages.tsx", import.meta.url), "utf8");
    expect(source).toContain('if (section !== "compose") return undefined;');
    expect(source).toContain('if (section !== "inbox" || !firebaseReady || !db) return undefined;');
  });
});
