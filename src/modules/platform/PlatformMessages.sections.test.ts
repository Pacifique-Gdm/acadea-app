import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../firebase", () => ({ db: null, firebaseReady: false }));
vi.mock("../../services/schoolMessaging", () => ({ searchPlatformRecipients: vi.fn(), clearPlatformRecipientCache: vi.fn(), sendPlatformMessage: vi.fn() }));

import { PlatformMessages, type PlatformInbox } from "./PlatformMessages";
import type { AppUser, Message } from "../../types";

const user = { id: "super-1", role: "super_admin", name: "Plateforme" } as AppUser;
const inbox = (messages: Message[] | null): PlatformInbox => ({ unread: [], messages, start: () => undefined });

describe("lot SA-6a : messagerie du Super administrateur", () => {
  it("l'onglet Messages ne montre que le formulaire « Nouveau message »", () => {
    const markup = renderToStaticMarkup(createElement(PlatformMessages, { user, section: "compose" }));
    expect(markup).toContain("Nouveau message");
    expect(markup).not.toContain("Messages et réponses");
  });

  it("la cloche ne montre que « Messages et réponses »", () => {
    const markup = renderToStaticMarkup(createElement(PlatformMessages, { user, section: "inbox", inbox: inbox([]) }));
    expect(markup).toContain("Messages et réponses");
    expect(markup).not.toContain("Nouveau message");
    expect(markup).not.toContain("Destinataires");
  });

  it("le module place chaque partie à son endroit", () => {
    const source = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
    expect(source).toContain('<MessagingDrawerShell onClose={() => setMessagingOpen(false)}><PlatformMessages user={user} section="inbox" inbox={platformInbox} /></MessagingDrawerShell>');
    expect(source).toMatch(/<KeptTab id="messages"[^>]*>\s*<PlatformMessages user=\{user\} section="compose" \/>/);
    expect(source.match(/<PlatformMessages /g)).toHaveLength(2);
  });
});

describe("lot SA-6 : destinataires cherchés et messagerie chargée une seule fois", () => {
  it("« Nouveau message » propose une recherche par nom au lieu de la liste complète", () => {
    const markup = renderToStaticMarkup(createElement(PlatformMessages, { user, section: "compose" }));
    expect(markup).toContain('aria-label="Rechercher un destinataire"');
    expect(markup).toContain("Rechercher un nom ou une coordination…");
    expect(markup).toContain("Chargement…");
    const source = readFileSync(new URL("./PlatformMessages.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("loadPlatformRecipients");
    expect(source).toContain("searchPlatformRecipients(role, text, page)");
    expect(source).toContain('useRecipientSearch(role, search, section === "compose")');
  });

  it("la cloche reçoit sa boîte du module : une seule écoute des non-lus, messages écoutés après la première ouverture puis gardés", () => {
    const module = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
    expect(module).toContain("const platformInbox = usePlatformInbox(user.id);");
    expect(module).toContain("const platformUnread = platformInbox.unread.length;");
    expect(module).toContain("onClick={() => { platformInbox.start(); setMessagingOpen(true); }}");
    expect(module).not.toContain("usePlatformUnreadCount");
    const source = readFileSync(new URL("./PlatformMessages.tsx", import.meta.url), "utf8");
    // La partie « cloche » n'ouvre plus aucune écoute à elle : tout passe par usePlatformInbox.
    expect(source.match(/onSnapshot\(/g)).toHaveLength(2);
    expect(source).toContain("if (!started || !firebaseReady || !db || !userId) return undefined;");
  });

  it("la boîte affiche « Chargement… » à la toute première ouverture, puis les messages gardés", () => {
    expect(renderToStaticMarkup(createElement(PlatformMessages, { user, section: "inbox", inbox: inbox(null) }))).toContain("Chargement…");
    const kept = [{ id: "m1", senderId: "admin-1", senderName: "Marie", senderRole: "school_admin", subject: "Bonjour", body: "Réponse", createdAt: "2026-11-20T08:00:00.000Z" } as unknown as Message];
    const markup = renderToStaticMarkup(createElement(PlatformMessages, { user, section: "inbox", inbox: inbox(kept) }));
    expect(markup).toContain("Bonjour");
    expect(markup).not.toContain("Chargement…");
  });
});
