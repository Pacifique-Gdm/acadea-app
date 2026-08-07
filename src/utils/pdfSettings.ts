export const PDF_FONT_FAMILIES = ["Aptos", "Calibri", "Times New Roman", "Arial", "Cambria", "Georgia", "Garamond", "Book Antiqua", "Verdana", "Tahoma", "Trebuchet MS"] as const;
export const PDF_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18] as const;
export const PDF_LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3] as const;
export const PDF_PAGE_SIZES = ["A4", "A5", "LETTER"] as const;

export type PdfFontFamily = (typeof PDF_FONT_FAMILIES)[number];
export type PdfFontSize = (typeof PDF_FONT_SIZES)[number];
export type PdfLineSpacing = (typeof PDF_LINE_SPACINGS)[number];
export type PdfPageSize = (typeof PDF_PAGE_SIZES)[number];

export type PdfGenerationSettings = {
  fontFamily: PdfFontFamily;
  fontSize: PdfFontSize;
  lineSpacing: PdfLineSpacing;
  pageSize: PdfPageSize;
};

export const DEFAULT_PDF_SETTINGS: PdfGenerationSettings = {
  fontFamily: "Aptos",
  fontSize: 12,
  lineSpacing: 1.15,
  pageSize: "A4",
};

const dimensions: Record<PdfPageSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  LETTER: { width: 215.9, height: 279.4 },
};

export function normalizePdfSettings(value?: Partial<PdfGenerationSettings> | null): PdfGenerationSettings {
  return {
    fontFamily: PDF_FONT_FAMILIES.includes(value?.fontFamily as PdfFontFamily) ? value!.fontFamily as PdfFontFamily : DEFAULT_PDF_SETTINGS.fontFamily,
    fontSize: PDF_FONT_SIZES.includes(value?.fontSize as PdfFontSize) ? value!.fontSize as PdfFontSize : DEFAULT_PDF_SETTINGS.fontSize,
    lineSpacing: PDF_LINE_SPACINGS.includes(value?.lineSpacing as PdfLineSpacing) ? value!.lineSpacing as PdfLineSpacing : DEFAULT_PDF_SETTINGS.lineSpacing,
    pageSize: PDF_PAGE_SIZES.includes(value?.pageSize as PdfPageSize) ? value!.pageSize as PdfPageSize : DEFAULT_PDF_SETTINGS.pageSize,
  };
}

export function resolvePdfFont(fontFamily: PdfFontFamily) {
  const stacks: Record<PdfFontFamily, string> = {
    Aptos: 'Aptos, Calibri, Arial, sans-serif', Calibri: 'Calibri, Aptos, Arial, sans-serif',
    "Times New Roman": '"Times New Roman", Times, serif', Arial: 'Arial, Helvetica, sans-serif',
    Cambria: 'Cambria, Georgia, "Times New Roman", serif', Georgia: 'Georgia, Cambria, "Times New Roman", serif',
    Garamond: 'Garamond, Georgia, "Times New Roman", serif', "Book Antiqua": '"Book Antiqua", Palatino, Georgia, serif',
    Verdana: 'Verdana, Geneva, sans-serif', Tahoma: 'Tahoma, Verdana, sans-serif', "Trebuchet MS": '"Trebuchet MS", Arial, sans-serif',
  };
  return stacks[fontFamily];
}

export function pdfEditorStyle(settings: Partial<PdfGenerationSettings> | null | undefined) {
  const normalized = normalizePdfSettings(settings);
  return { fontFamily: resolvePdfFont(normalized.fontFamily), fontSize: `${normalized.fontSize}pt`, lineHeight: normalized.lineSpacing };
}

export function getPdfLineHeight(settings: Partial<PdfGenerationSettings> | null | undefined) {
  return normalizePdfSettings(settings).lineSpacing;
}

export function getPdfPageDimensions(pageSize: PdfPageSize) {
  return dimensions[pageSize];
}

export function getPdfLayout(settings?: Partial<PdfGenerationSettings> | null) {
  const normalized = normalizePdfSettings(settings);
  const page = getPdfPageDimensions(normalized.pageSize);
  const margins = { top: 14, right: 14, bottom: 18, left: 14 };
  const contentWidth = page.width - margins.left - margins.right;
  const contentHeight = page.height - margins.top - margins.bottom;
  const pixelsPerMillimeter = 688 / 182;
  return {
    settings: normalized,
    page,
    margins,
    contentWidth,
    contentHeight,
    windowWidth: Math.round(contentWidth * pixelsPerMillimeter),
    jsPdfFormat: normalized.pageSize.toLowerCase() as "a4" | "a5" | "letter",
  };
}

const storageKey = "acadea:secretary:pdf-settings";

export function readStoredPdfSettings() {
  if (typeof localStorage === "undefined") return DEFAULT_PDF_SETTINGS;
  try {
    return normalizePdfSettings(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    return DEFAULT_PDF_SETTINGS;
  }
}

export function storePdfSettings(settings: PdfGenerationSettings) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey, JSON.stringify(normalizePdfSettings(settings)));
}
