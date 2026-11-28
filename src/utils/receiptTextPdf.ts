/**
 * Reçu de paiement écrit en vrai texte (moteur `pdfTextEngine`).
 *
 * Même aspect que l'ancien reçu dessiné en image : une page A4, deux
 * exemplaires (école et parent) séparés par la ligne « Découper ici ».
 * Chaque exemplaire garde son bandeau (logo, école), son étiquette, son cadre
 * de titre, ses cases, la signature et son pied de page.
 *
 * Les mesures reprennent celles de l'ancien style (pixels CSS convertis en
 * millimètres), pour que les deux versions se superposent presque exactement.
 */
import { PDF_PX_TO_MM, PDF_PX_TO_PT, PDF_TEXT_COLORS, TextPdfWriter, type PdfTextFont, type TextPdfLogo } from "./pdfTextEngine";

export type ReceiptTextField = {
  label: string;
  value: string;
  /** La case prend toute la largeur (description longue). */
  wide?: boolean;
  /** Montant : jamais coupé, taille réduite si besoin. */
  amount?: boolean;
  /** Texte qui peut rapetisser si l'exemplaire déborde (description). */
  shrinkable?: boolean;
};

export type ReceiptTextPdfInput = {
  title: string;
  school: { name: string; motto?: string; contactLine: string };
  logo: TextPdfLogo | null;
  /** Lettres du logo de secours quand l'école n'a pas d'image. */
  brandLetters: string;
  copyLabels: readonly [string, string];
  generatedAt: Date;
  fields: ReceiptTextField[];
  signatory: { name: string; role: string };
};

const px = (value: number) => value * PDF_PX_TO_MM;
const font = (sizePx: number, options: Omit<PdfTextFont, "size"> = {}): PdfTextFont => ({ size: sizePx * PDF_PX_TO_PT, ...options });

const LEFT = 14;
const TOP = 14;
const WIDTH = 182;
const HEIGHT = 297 - 14 - 18;
const CUT_ROW = px(22);
const COPY_HEIGHT = (HEIGHT - CUT_ROW) / 2;
const INSET = px(12);
const MIN_SHRINK_PX = 5;

type Layout = { fields: Array<ReceiptTextField & { column: 0 | 1 | "all"; row: number }>; rows: number };

/** Place les cases comme la grille CSS à 2 colonnes : une case large commence une nouvelle ligne. */
export function layoutReceiptFields(fields: ReceiptTextField[]): Layout {
  const placed: Layout["fields"] = [];
  let row = 0;
  let column: 0 | 1 = 0;
  for (const field of fields) {
    if (field.wide) {
      if (column === 1) { row += 1; column = 0; }
      placed.push({ ...field, column: "all", row });
      row += 1;
      continue;
    }
    placed.push({ ...field, column, row });
    if (column === 1) { row += 1; column = 0; } else column = 1;
  }
  return { fields: placed, rows: column === 1 ? row + 1 : row };
}

function drawHeader(pdf: TextPdfWriter, input: ReceiptTextPdfInput, y: number) {
  const brand = px(34);
  const gap = px(8);
  const padX = px(12);
  const padY = px(6);
  const blockX = LEFT + padX + brand + gap;
  const blockWidth = WIDTH - padX * 2 - brand - gap;
  const nameFont = font(13, { bold: true, color: PDF_TEXT_COLORS.white });
  const lineFont = font(7, { color: PDF_TEXT_COLORS.headerMuted });
  const mottoFont = font(7, { bold: true, color: PDF_TEXT_COLORS.headerMuted });
  const nameLines = pdf.wrap(input.school.name, blockWidth, nameFont);
  const mottoLines = input.school.motto ? pdf.wrap(`Devise : ${input.school.motto}`, blockWidth, mottoFont) : [];
  const contactLines = input.school.contactLine ? pdf.wrap(input.school.contactLine, blockWidth, lineFont) : [];
  const nameHeight = nameLines.length * pdf.lineHeight(nameFont, 1.08) + px(1);
  const smallStep = pdf.lineHeight(lineFont, 1.12) + px(2);
  const blockHeight = nameHeight + (mottoLines.length + contactLines.length) * smallStep;
  const height = Math.max(px(40), blockHeight + padY * 2) + px(2);

  pdf.rect(LEFT, y, WIDTH, height, { fill: PDF_TEXT_COLORS.navy });
  pdf.rect(LEFT, y + height - px(2), WIDTH, px(2), { fill: PDF_TEXT_COLORS.teal });

  const inner = height - px(2);
  const brandY = y + (inner - brand) / 2;
  pdf.rect(LEFT + padX, brandY, brand, brand, { fill: PDF_TEXT_COLORS.white, stroke: [161, 166, 177], lineWidth: px(2) });
  if (input.logo) {
    pdf.imageContain(input.logo.dataUrl, input.logo.format, LEFT + padX + px(2), brandY + px(2), brand - px(4), brand - px(4), input.logo.width, input.logo.height);
  } else if (input.brandLetters) {
    const letterFont = font(14, { bold: true });
    const size = pdf.fitFontSize(input.brandLetters, brand - px(6), letterFont);
    const lettersFont = { ...letterFont, size };
    pdf.text(input.brandLetters, LEFT + padX + brand / 2, brandY + (brand - pdf.lineHeight(lettersFont)) / 2, lettersFont, { align: "center" });
  }

  let textY = y + (inner - blockHeight) / 2;
  textY += pdf.text(nameLines, blockX, textY, nameFont, { lineSpacing: 1.08 }) + px(1);
  for (const line of mottoLines) textY += pdf.text(line, blockX, textY + px(1), mottoFont, { lineSpacing: 1.12 }) + px(2);
  for (const line of contactLines) textY += pdf.text(line, blockX, textY + px(1), lineFont, { lineSpacing: 1.12 }) + px(2);
  return height;
}

function drawTitle(pdf: TextPdfWriter, input: ReceiptTextPdfInput, y: number) {
  const x = LEFT + INSET;
  const width = WIDTH - INSET * 2;
  const brandFont = font(6.5, { bold: true, color: PDF_TEXT_COLORS.teal });
  const titleFont = font(11.5, { bold: true });
  const dateFont = font(7, { color: PDF_TEXT_COLORS.muted });
  const height = px(4) + pdf.lineHeight(brandFont, 1.15) + px(2) + pdf.lineHeight(titleFont, 1.12) + px(2) + pdf.lineHeight(dateFont, 1.5) + px(6);
  pdf.rect(x, y, width, height, { fill: PDF_TEXT_COLORS.soft, stroke: PDF_TEXT_COLORS.border });
  let textY = y + px(4);
  textY += pdf.text("ACADÉA", x + px(7), textY, brandFont, { lineSpacing: 1.15 }) + px(2);
  textY += pdf.text(input.title, x + px(7), textY, titleFont, { lineSpacing: 1.12 }) + px(2);
  pdf.text(`Date de génération : ${input.generatedAt.toLocaleString("fr-FR")}`, x + px(7), textY, dateFont, { lineSpacing: 1.5 });
  return height;
}

type MeasuredBox = { field: Layout["fields"][number]; x: number; width: number; labelFont: PdfTextFont; valueFont: PdfTextFont; valueLines: string[]; height: number };

function measureFields(pdf: TextPdfWriter, layout: Layout, shrinkPx: number) {
  const gapX = px(6);
  const padding = px(6);
  const columnWidth = (WIDTH - gapX) / 2;
  const labelFont = font(6.5, { color: PDF_TEXT_COLORS.label });
  const boxes: MeasuredBox[] = layout.fields.map((field) => {
    const x = field.column === 1 ? LEFT + columnWidth + gapX : LEFT;
    const width = field.column === "all" ? WIDTH : columnWidth;
    const inner = width - padding * 2;
    let valueFont = font(field.shrinkable ? shrinkPx : 8.5, { bold: true });
    let valueLines: string[];
    if (field.amount) {
      valueFont = { ...valueFont, size: pdf.fitFontSize(field.value, inner, valueFont) };
      valueLines = [field.value];
    } else valueLines = pdf.wrap(field.value, inner, valueFont);
    const labelLines = pdf.wrap(field.label.toLocaleUpperCase("fr"), inner, labelFont);
    const lineSpacing = field.shrinkable && shrinkPx < 8.5 ? 1.15 : 1.22;
    const content = labelLines.length * pdf.lineHeight(labelFont, 1.2) + px(2) + valueLines.length * pdf.lineHeight(valueFont, lineSpacing);
    return { field, x, width, labelFont, valueFont, valueLines, height: Math.max(px(35), content + padding * 2) };
  });
  const rowHeights = Array.from({ length: layout.rows }, (_, row) => Math.max(0, ...boxes.filter((box) => box.field.row === row).map((box) => box.height)));
  const total = rowHeights.reduce((sum, height) => sum + height, 0) + px(4) * Math.max(0, layout.rows - 1);
  return { boxes, rowHeights, total };
}

function signatureHeight(pdf: TextPdfWriter) {
  return px(5) + pdf.lineHeight(font(7.5), 1.15) + px(18) + px(1) + px(3) + pdf.lineHeight(font(8.5), 1.2) + px(1) + pdf.lineHeight(font(7.5), 1.2);
}

function drawCopy(pdf: TextPdfWriter, input: ReceiptTextPdfInput, label: string, top: number, layout: Layout) {
  let y = top;
  y += drawHeader(pdf, input, y);
  const labelFont = font(7.5, { bold: true, color: PDF_TEXT_COLORS.teal });
  y += px(5);
  y += pdf.text(label.toLocaleUpperCase("fr"), LEFT + WIDTH - INSET, y, labelFont, { align: "right", lineSpacing: 1.15 });
  y += px(4);
  y += drawTitle(pdf, input, y);
  y += px(5);

  // Pied de page de l'exemplaire : en bas de sa demi-page.
  const footerFont = font(6.5, { color: PDF_TEXT_COLORS.label });
  const footerHeight = px(3) + pdf.lineHeight(footerFont, 1.1);
  const footerTop = top + COPY_HEIGHT - px(4) - footerHeight;

  // Comme l'ancien moteur : la description rapetisse pas à pas si l'exemplaire déborde.
  const available = footerTop - px(2) - y - px(4) - signatureHeight(pdf);
  let shrink = 8.5;
  let measured = measureFields(pdf, layout, shrink);
  while (measured.total > available && shrink > MIN_SHRINK_PX && layout.fields.some((field) => field.shrinkable)) {
    shrink = Math.max(MIN_SHRINK_PX, shrink - 0.5);
    measured = measureFields(pdf, layout, shrink);
  }

  let rowY = y;
  measured.rowHeights.forEach((rowHeight, row) => {
    for (const box of measured.boxes.filter((item) => item.field.row === row)) {
      pdf.rect(box.x, rowY, box.width, rowHeight, { fill: PDF_TEXT_COLORS.white, stroke: PDF_TEXT_COLORS.border });
      const padding = px(6);
      const inner = box.width - padding * 2;
      const labelLines = pdf.wrap(box.field.label.toLocaleUpperCase("fr"), inner, box.labelFont);
      const lineSpacing = box.field.shrinkable && shrink < 8.5 ? 1.15 : 1.22;
      const content = labelLines.length * pdf.lineHeight(box.labelFont, 1.2) + px(2) + box.valueLines.length * pdf.lineHeight(box.valueFont, lineSpacing);
      let textY = rowY + (rowHeight - content) / 2;
      textY += pdf.text(labelLines, box.x + padding, textY, box.labelFont, { lineSpacing: 1.2 }) + px(2);
      pdf.text(box.valueLines, box.x + padding, textY, box.valueFont, { lineSpacing });
    }
    rowY += rowHeight + px(4);
  });
  y = rowY;

  // Signature, alignée à droite comme avant.
  const signatureWidth = px(170);
  const signatureX = LEFT + WIDTH - INSET - signatureWidth;
  const center = signatureX + signatureWidth / 2;
  y += px(5);
  y += pdf.text("Signature et cachet", center, y, font(7.5, { color: PDF_TEXT_COLORS.slate }), { align: "center", lineSpacing: 1.15 });
  y += px(18);
  pdf.line(signatureX, y, signatureX + signatureWidth, y, PDF_TEXT_COLORS.navy, { lineWidth: px(1) });
  y += px(1) + px(3);
  y += pdf.text(input.signatory.name, center, y, font(8.5, { bold: true }), { align: "center" }) + px(1);
  pdf.text(input.signatory.role, center, y, font(7.5, { color: PDF_TEXT_COLORS.slate }), { align: "center" });

  pdf.line(LEFT + INSET, footerTop, LEFT + WIDTH - INSET, footerTop, PDF_TEXT_COLORS.border, { lineWidth: px(1) });
  pdf.text(`Généré par Acadéa | ${input.generatedAt.toLocaleString("fr-FR")}`, LEFT + INSET, footerTop + px(3), footerFont, { lineSpacing: 1.1 });
}

function drawCutLine(pdf: TextPdfWriter, y: number) {
  const middle = y + CUT_ROW / 2;
  pdf.line(LEFT + INSET, middle, LEFT + WIDTH - INSET, middle, PDF_TEXT_COLORS.cut, { lineWidth: px(1), dash: [1, 0.8] });
  const labelFont = font(6.5, { color: PDF_TEXT_COLORS.label });
  const labelWidth = pdf.textWidth("Découper ici", labelFont) + px(14);
  pdf.rect(LEFT + WIDTH / 2 - labelWidth / 2, middle - px(5), labelWidth, px(10), { fill: PDF_TEXT_COLORS.white });
  pdf.text("Découper ici", LEFT + WIDTH / 2, middle - pdf.lineHeight(labelFont) / 2, labelFont, { align: "center" });
}

/** Fabrique le reçu (une page A4, deux exemplaires) et renvoie le document. */
export function buildReceiptTextPdf(input: ReceiptTextPdfInput) {
  const pdf = new TextPdfWriter({ format: "a4" });
  pdf.doc.setDocumentProperties({ title: input.title, creator: "Acadéa" });
  const layout = layoutReceiptFields(input.fields);
  drawCopy(pdf, input, input.copyLabels[0], TOP, layout);
  drawCutLine(pdf, TOP + COPY_HEIGHT);
  drawCopy(pdf, input, input.copyLabels[1], TOP + COPY_HEIGHT + CUT_ROW, layout);
  return pdf;
}
