import { describe, expect, it } from "vitest";
import {
  LOGIN_IMAGE_BLUR_MAX_BYTES,
  makeLoginImageBlurDataUrl,
  parseLoginImage,
  readCachedLoginImageBlur,
  writeCachedLoginImageBlur,
} from "./loginImage";

// Fond flou : copie floue préparée une seule fois au choix de l'image par le Super administrateur.
const IMAGE = "data:image/webp;base64,AAAA";
const BLUR = "data:image/jpeg;base64,BBBB";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

type Draw = { args: unknown[]; filter?: string };
function fakeCanvasFactory(options: { withFilter?: boolean; output?: string; throws?: boolean } = {}) {
  const canvases: { width: number; height: number; draws: Draw[]; quality?: number; type?: string }[] = [];
  const create = () => {
    const record = { width: 0, height: 0, draws: [] as Draw[], quality: undefined as number | undefined, type: undefined as string | undefined };
    canvases.push(record);
    const context: { filter?: string; imageSmoothingEnabled?: boolean; drawImage: (...args: unknown[]) => void } = {
      drawImage: (...args: unknown[]) => {
        if (options.throws) throw new Error("dessin impossible");
        record.draws.push({ args, filter: context.filter });
      },
    };
    if (options.withFilter !== false) context.filter = "none";
    return {
      get width() { return record.width; },
      set width(value: number) { record.width = value; },
      get height() { return record.height; },
      set height(value: number) { record.height = value; },
      getContext: () => context,
      toDataURL: (type: string, quality: number) => { record.type = type; record.quality = quality; return options.output ?? BLUR; },
    };
  };
  return { create, canvases };
}

const photo = { naturalWidth: 900, naturalHeight: 1350 } as unknown as HTMLImageElement;

describe("fond flou : service de l'image de connexion", () => {
  it("calcule la copie floue : 480 points de large, flou léger de 2 points, JPEG léger", () => {
    const { create, canvases } = fakeCanvasFactory();
    expect(makeLoginImageBlurDataUrl(photo, create)).toBe(BLUR);
    expect(canvases[0].width).toBe(480);
    expect(canvases[0].height).toBe(720);
    expect(canvases[0].draws[0].filter).toBe("blur(2px)");
    // Bords prolongés pour ne pas les assombrir.
    expect(canvases[0].draws[0].args.slice(1)).toEqual([-6, -6, 492, 732]);
    expect(canvases[0].type).toBe("image/jpeg");
    expect(canvases[0].quality).toBe(0.7);
  });

  it("navigateur sans flou de dessin : petite image agrandie (flou proche), sans erreur", () => {
    const { create, canvases } = fakeCanvasFactory({ withFilter: false });
    expect(makeLoginImageBlurDataUrl(photo, create)).toBe(BLUR);
    expect(canvases).toHaveLength(2);
    expect(canvases[1].width).toBe(160);
  });

  it("valeur de repli : échec ou copie trop lourde → chaîne vide (l'écran garde son fond d'aujourd'hui)", () => {
    expect(makeLoginImageBlurDataUrl(photo, fakeCanvasFactory({ throws: true }).create)).toBe("");
    const heavy = `data:image/jpeg;base64,${"A".repeat(Math.ceil(((LOGIN_IMAGE_BLUR_MAX_BYTES + 1024) * 4) / 3))}`;
    expect(makeLoginImageBlurDataUrl(photo, fakeCanvasFactory({ output: heavy }).create)).toBe("");
    expect(makeLoginImageBlurDataUrl({ naturalWidth: 0, naturalHeight: 0 } as unknown as HTMLImageElement, fakeCanvasFactory().create)).toBe("");
  });

  it("lecture : garde la copie floue valide d'une image, refuse le reste", () => {
    expect(parseLoginImage({ imageDataUrl: IMAGE, updatedAt: "t", blurDataUrl: BLUR })).toEqual({ imageDataUrl: IMAGE, updatedAt: "t", blurDataUrl: BLUR });
    expect(parseLoginImage({ imageDataUrl: IMAGE, updatedAt: "t", blurDataUrl: "https://pirate.example/b.jpg" })).toEqual({ imageDataUrl: IMAGE, updatedAt: "t" });
    expect(parseLoginImage({ imageDataUrl: "", blurDataUrl: BLUR })).toEqual({ imageDataUrl: "", updatedAt: "" });
    expect("blurDataUrl" in parseLoginImage({ imageDataUrl: IMAGE, updatedAt: "t" })).toBe(false);
  });

  it("garde la copie floue sur l'appareil (affichage immédiat), et l'efface au retour à l'image d'origine", () => {
    const storage = memoryStorage();
    expect(readCachedLoginImageBlur(storage)).toBe("");
    writeCachedLoginImageBlur(BLUR, storage);
    expect(readCachedLoginImageBlur(storage)).toBe(BLUR);
    writeCachedLoginImageBlur("", storage);
    expect(readCachedLoginImageBlur(storage)).toBe("");
    storage.setItem("acadea.loginImageBlur.v1", "https://pirate.example/b.jpg");
    expect(readCachedLoginImageBlur(storage)).toBe("");
  });
});
