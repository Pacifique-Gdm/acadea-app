/**
 * Moteur PDF « vrai texte » (lot PDF en vrai texte, étape 1).
 *
 * Il écrit le texte directement dans le PDF (jsPDF, police Helvetica intégrée
 * au lecteur PDF) au lieu de photographier une page HTML. Le texte peut donc
 * être cherché et copié, et le fichier est bien plus léger.
 *
 * Il est ajouté à côté de l'ancien moteur (`pdf.ts`) : seul le reçu de
 * paiement l'utilise pour l'instant.
 *
 * Règles du moteur :
 * - un montant (texte sans espace ordinaire) n'est jamais coupé : s'il est
 *   trop large, sa taille diminue ;
 * - les espaces fines des nombres français deviennent des espaces insécables :
 *   « 1 250,00 FC » reste sur une seule ligne ;
 * - une nouvelle page n'est ajoutée que juste avant de dessiner quelque chose
 *   (`ensureSpace`) : jamais de page blanche, même pour une très longue liste ;
 * - la page est toujours en millimètres au format demandé (A4 par défaut),
 *   identique sur téléphone et sur ordinateur, car rien ne dépend de l'écran.
 */
import jsPDF from "jspdf";

/** Fonctions de jsPDF utilisées ici et absentes de la déclaration réduite du projet (`vite-env.d.ts`). */
type TextPdfDocument = Omit<InstanceType<typeof jsPDF>, "text" | "output"> & {
  text(text: string, x: number, y: number, options?: { align?: "left" | "right" | "center"; baseline?: "alphabetic" | "top" | "middle" | "bottom" }): void;
  output(type: "blob"): Blob;
  output(type: "arraybuffer"): ArrayBuffer;
  getTextWidth(text: string): number;
  setLineWidth(width: number): void;
  setLineDashPattern(pattern: number[], phase: number): void;
  setDocumentProperties(properties: { title?: string; creator?: string }): void;
};

export type PdfRgb = readonly [number, number, number];

/** Rapport de l'ancien moteur : 688 px CSS pour 182 mm de contenu. */
export const PDF_PX_TO_MM = 182 / 688;
/** Un pixel CSS vaut 0,75 point typographique. */
export const PDF_PX_TO_PT = 0.75;
const PT_TO_MM = 25.4 / 72;

export const PDF_TEXT_COLORS = {
  navy: [20, 33, 61],
  teal: [42, 157, 143],
  white: [255, 255, 255],
  headerMuted: [229, 237, 246],
  border: [219, 228, 239],
  soft: [248, 250, 252],
  label: [100, 116, 139],
  muted: [82, 97, 115],
  slate: [71, 85, 105],
  cut: [148, 163, 184],
  footerLine: [220, 226, 235],
} as const satisfies Record<string, PdfRgb>;

export type PdfTextFont = { size: number; bold?: boolean; color?: PdfRgb };

const NO_BREAK_SPACE = "\u00a0";

/**
 * Prépare un texte pour la police Helvetica du PDF : accents français gardés,
 * espaces fines des nombres rendues insécables, signes absents de la police
 * remplacés par un équivalent lisible.
 */
export function pdfSafeText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u202f\u2007\u2009]/g, NO_BREAK_SPACE)
    .replace(/[\r\n\t]+/g, " ")
    // La devise reste collée au nombre : « 1 250,00 FC » ne se coupe jamais avant « FC ».
    .replace(/(\d) (FC|CDF|USD)(?![\p{L}\p{N}])/gu, `$1${NO_BREAK_SPACE}$2`)
    .replace(/[→⟶]/g, "->")
    .replace(/↳/g, "-")
    .replace(/[\u200b-\u200d\ufeff]/g, "");
}

export type TextPdfOptions = {
  format?: "a4" | "a5" | "letter";
  orientation?: "portrait" | "landscape";
  margins?: { top: number; right: number; bottom: number; left: number };
};

export type TextPdfTableColumn = {
  header: string;
  /** Part de la largeur du tableau. */
  weight: number;
  align?: "left" | "right" | "center";
  /** Montants : jamais coupés, taille réduite si besoin. */
  noWrap?: boolean;
};

export class TextPdfWriter {
  readonly doc: TextPdfDocument;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly margins: { top: number; right: number; bottom: number; left: number };
  /** Position verticale courante (mm) pour l'écriture en flux. */
  y: number;

  constructor({ format = "a4", orientation = "portrait", margins = { top: 14, right: 14, bottom: 18, left: 14 } }: TextPdfOptions = {}) {
    this.doc = new jsPDF({ unit: "mm", format, orientation, compress: true }) as unknown as TextPdfDocument;
    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();
    this.margins = margins;
    this.y = margins.top;
  }

  get contentWidth() {
    return this.pageWidth - this.margins.left - this.margins.right;
  }

  get contentBottom() {
    return this.pageHeight - this.margins.bottom;
  }

  get pageCount() {
    return this.doc.getNumberOfPages();
  }

  setFont(font: PdfTextFont) {
    this.doc.setFont("helvetica", font.bold ? "bold" : "normal");
    this.doc.setFontSize(font.size);
    const color = font.color ?? PDF_TEXT_COLORS.navy;
    this.doc.setTextColor(color[0], color[1], color[2]);
  }

  /** Largeur d'un texte en millimètres. */
  textWidth(text: string, font: PdfTextFont) {
    this.setFont(font);
    return this.doc.getTextWidth(pdfSafeText(text));
  }

  /** Hauteur d'une ligne en millimètres. */
  lineHeight(font: PdfTextFont, lineSpacing = 1.2) {
    return font.size * PT_TO_MM * lineSpacing;
  }

  /** Taille de police la plus grande (≤ taille demandée) pour que le texte tienne sur une ligne. */
  fitFontSize(text: string, width: number, font: PdfTextFont, minimumSize = 4) {
    let size = font.size;
    while (size > minimumSize && this.textWidth(text, { ...font, size }) > width) size = Math.max(minimumSize, size - 0.25);
    return size;
  }

  /**
   * Coupe un texte en lignes, seulement entre deux mots (espace ordinaire).
   * Un mot plus large que la ligne n'est coupé à l'intérieur que si
   * `breakLongWords` est demandé (jamais pour un montant).
   */
  wrap(text: string, width: number, font: PdfTextFont, { breakLongWords = true } = {}) {
    const safe = pdfSafeText(text).replace(/ +/g, " ").trim();
    if (!safe) return [""];
    const lines: string[] = [];
    let current = "";
    for (const word of safe.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.textWidth(candidate, font) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (breakLongWords && this.textWidth(word, font) > width) {
        let piece = "";
        for (const letter of Array.from(word)) {
          if (piece && this.textWidth(piece + letter, font) > width) {
            lines.push(piece);
            piece = letter;
          } else piece += letter;
        }
        current = piece;
      } else current = word;
    }
    if (current) lines.push(current);
    return lines;
  }

  /** Écrit des lignes ; `y` est le haut de la première ligne. */
  text(lines: string | string[], x: number, y: number, font: PdfTextFont, { align = "left", lineSpacing = 1.2 }: { align?: "left" | "right" | "center"; lineSpacing?: number } = {}) {
    const list = (Array.isArray(lines) ? lines : [lines]).map(pdfSafeText);
    this.setFont(font);
    const step = this.lineHeight(font, lineSpacing);
    list.forEach((line, index) => {
      // Ligne de base : environ 0,8 de la taille, centrée dans l'interligne.
      const baseline = y + index * step + (step - font.size * PT_TO_MM) / 2 + font.size * PT_TO_MM * 0.8;
      this.doc.text(line, x, baseline, { align, baseline: "alphabetic" });
    });
    return list.length * step;
  }

  rect(x: number, y: number, width: number, height: number, { fill, stroke, lineWidth = 0.26 }: { fill?: PdfRgb; stroke?: PdfRgb; lineWidth?: number } = {}) {
    if (fill) this.doc.setFillColor(fill[0], fill[1], fill[2]);
    if (stroke) {
      this.doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
      this.doc.setLineWidth(lineWidth);
    }
    const style = fill && stroke ? "FD" : fill ? "F" : "S";
    if (fill || stroke) this.doc.rect(x, y, width, height, style);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: PdfRgb, { lineWidth = 0.26, dash }: { lineWidth?: number; dash?: number[] } = {}) {
    this.doc.setDrawColor(color[0], color[1], color[2]);
    this.doc.setLineWidth(lineWidth);
    if (dash) this.doc.setLineDashPattern(dash, 0);
    this.doc.line(x1, y1, x2, y2);
    if (dash) this.doc.setLineDashPattern([], 0);
  }

  /** Image (logo) centrée dans la boîte, proportions gardées. */
  imageContain(dataUrl: string, format: "PNG" | "JPEG", x: number, y: number, width: number, height: number, naturalWidth: number, naturalHeight: number) {
    const ratio = Math.min(width / Math.max(1, naturalWidth), height / Math.max(1, naturalHeight));
    const drawWidth = naturalWidth * ratio;
    const drawHeight = naturalHeight * ratio;
    this.doc.addImage(dataUrl, format, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight, undefined, "FAST");
  }

  addPage() {
    this.doc.addPage();
    this.y = this.margins.top;
  }

  /**
   * Garantit la place pour un bloc de `height` mm à la position courante.
   * La nouvelle page n'est créée qu'à ce moment-là, donc jamais vide.
   * Renvoie vrai si une page a été ajoutée.
   */
  ensureSpace(height: number) {
    const pageIsEmpty = this.y <= this.margins.top + 0.01;
    if (this.y + height <= this.contentBottom || pageIsEmpty) return false;
    this.addPage();
    return true;
  }

  /**
   * Tableau en flux : chaque ligne reste entière, l'en-tête est répété en
   * haut de chaque nouvelle page. Fonctionne pour des milliers de lignes.
   */
  table(columns: TextPdfTableColumn[], rows: Array<Array<string | number>>, { font = { size: 8 } as PdfTextFont, headerFont = { size: 7.5, bold: true } as PdfTextFont, padding = 1.6, emptyLabel = "Aucune donnée" } = {}) {
    const x0 = this.margins.left;
    const total = columns.reduce((sum, column) => sum + column.weight, 0) || 1;
    const widths = columns.map((column) => (column.weight / total) * this.contentWidth);
    const lineSpacing = 1.25;

    const layoutRow = (cells: Array<string | number>, cellFont: PdfTextFont) => {
      const laid = cells.map((cell, index) => {
        const inner = widths[index] - padding * 2;
        const column = columns[index];
        if (column?.noWrap) {
          const size = this.fitFontSize(String(cell), inner, cellFont);
          return { lines: [pdfSafeText(cell)], font: { ...cellFont, size } };
        }
        return { lines: this.wrap(String(cell), inner, cellFont), font: cellFont };
      });
      const height = Math.max(...laid.map((cell) => cell.lines.length * this.lineHeight(cell.font, lineSpacing))) + padding * 2;
      return { laid, height };
    };

    const drawRow = (cells: ReturnType<typeof layoutRow>, fill?: PdfRgb) => {
      let x = x0;
      cells.laid.forEach((cell, index) => {
        this.rect(x, this.y, widths[index], cells.height, { fill, stroke: PDF_TEXT_COLORS.border });
        const align = columns[index]?.align ?? "left";
        const textX = align === "right" ? x + widths[index] - padding : align === "center" ? x + widths[index] / 2 : x + padding;
        this.text(cell.lines, textX, this.y + padding, cell.font, { align, lineSpacing });
        x += widths[index];
      });
      this.y += cells.height;
    };

    const header = layoutRow(columns.map((column) => column.header), { ...headerFont, color: headerFont.color ?? PDF_TEXT_COLORS.white });
    const drawHeader = () => drawRow(header, PDF_TEXT_COLORS.navy);
    const body = rows.length ? rows : [[emptyLabel, ...columns.slice(1).map(() => "")]];

    const first = layoutRow(body[0], font);
    this.ensureSpace(header.height + first.height);
    drawHeader();
    body.forEach((row, index) => {
      const laid = index === 0 ? first : layoutRow(row, font);
      if (this.ensureSpace(laid.height)) drawHeader();
      drawRow(laid, index % 2 ? PDF_TEXT_COLORS.soft : undefined);
    });
  }

  /** Même pied de page que l'ancien moteur : « Généré par Acadéa » et « Page x / n ». */
  addPageFooters(generatedAt: Date, showGeneratedAt = true) {
    const pages = this.pageCount;
    for (let page = 1; page <= pages; page += 1) {
      this.doc.setPage(page);
      this.line(16, this.pageHeight - 14, this.pageWidth - 16, this.pageHeight - 14, PDF_TEXT_COLORS.footerLine);
      this.setFont({ size: 7.5, color: PDF_TEXT_COLORS.label });
      if (showGeneratedAt) this.doc.text(pdfSafeText(`Généré par Acadéa | ${generatedAt.toLocaleString("fr-FR")}`), 16, this.pageHeight - 8);
      this.doc.text(`Page ${page} / ${pages}`, this.pageWidth - 38, this.pageHeight - 8);
    }
  }

  outputBlob() {
    return this.doc.output("blob");
  }

  outputArrayBuffer() {
    return this.doc.output("arraybuffer");
  }
}

export type TextPdfLogo = { dataUrl: string; format: "PNG" | "JPEG"; width: number; height: number };

/**
 * Prépare le logo pour le PDF : dans le navigateur, il est redessiné en petit
 * JPEG sur fond blanc (tout format d'image accepté, poids réduit). Sans
 * navigateur (tests), seuls PNG et JPEG sont gardés tels quels.
 */
export async function prepareTextPdfLogo(dataUrl: string, maximumPixels = 240): Promise<TextPdfLogo | null> {
  if (!dataUrl) return null;
  if (typeof document === "undefined" || typeof Image === "undefined") {
    const format = /^data:image\/png/i.test(dataUrl) ? "PNG" : /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : null;
    return format ? { dataUrl, format, width: 1, height: 1 } : null;
  }
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = dataUrl;
  });
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;
  const ratio = Math.min(1, maximumPixels / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.92), format: "JPEG", width: canvas.width, height: canvas.height };
}
