import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = () => readFileSync("src/components/auth/LoginScreen.tsx", "utf8");

describe("écran de connexion sur téléphone : la photo reste visible", () => {
  it("place le slogan sous la photo sur téléphone, sur la photo seulement sur ordinateur", () => {
    const source = screen();
    const aside = source.slice(source.indexOf("<aside"), source.indexOf("</aside>"));
    expect(aside).toContain("hidden p-5 pb-10 text-white lg:block");
    const afterAside = source.slice(source.indexOf("</aside>"));
    expect(afterAside).toMatch(/<h1 className="[^"]*lg:hidden[^"]*">\{LOGIN_SLOGAN\}<\/h1>/);
  });

  it("n'assombrit plus la photo sur téléphone et garde le dégradé de l'ordinateur", () => {
    const source = screen();
    expect(source).toContain("from-[#14213d]/30 via-transparent to-transparent lg:from-[#14213d]/90 lg:via-[#14213d]/45");
  });

  it("la carte de connexion ne recouvre plus la photo", () => {
    expect(screen()).not.toContain("-mt-6");
  });
});
