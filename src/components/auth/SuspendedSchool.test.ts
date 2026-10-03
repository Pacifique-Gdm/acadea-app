import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SuspendedSchool, SUSPENDED_SCHOOL_MESSAGE } from "./SuspendedSchool";

describe("école suspendue", () => {
  it("n'expose que le message exact et la déconnexion", () => {
    expect(SUSPENDED_SCHOOL_MESSAGE).toBe("CETTE ÉCOLE A ÉTÉ SUSPENDUE, VEUILLEZ CONTACTER L'ÉQUIPE ACADÉA. MERCI");
    const html = renderToStaticMarkup(createElement(SuspendedSchool, { logoUrl: "", onLogout: () => undefined }));
    expect(html).toContain(SUSPENDED_SCHOOL_MESSAGE.replaceAll("'", "&#x27;"));
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain("Déconnexion");
    expect(html).not.toContain("Dashboard");
    expect(html).not.toContain("A ÉTÉ SUSPENDRE");
  });
});
