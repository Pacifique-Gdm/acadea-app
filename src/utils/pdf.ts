import jsPDF from "jspdf";
import type { FeeType, Payment, School, SchoolYear, Student } from "../types";
import { getPdfLayout, resolvePdfFont, type PdfGenerationSettings } from "./pdfSettings";

type PdfDoc = InstanceType<typeof jsPDF>;

export type PdfTableColumn<T> = {
  header: string;
  render: (item: T, index: number) => string | number;
  align?: "left" | "right" | "center";
};

export type PdfMetric = {
  label: string;
  value: string | number;
};

type AcadPdfOptions = {
  filename: string;
  title: string;
  school: School;
  year?: SchoolYear;
  subtitle?: string;
  generatedAt?: Date;
  showDocumentTitle?: boolean;
  centerDocumentTitle?: boolean;
  pdfSettings?: Partial<PdfGenerationSettings>;
  sections: string[];
  copyLabels?: readonly [string, string];
  singlePageFit?: boolean;
};

function formatStudentClassName(student: Pick<Student, "className" | "option">) {
  const isSecondary = student.className.includes("Humanité");
  const option = student.option?.trim();
  if (!isSecondary || !option) return student.className;
  const classLabel = student.className.replace(/\s+Humanit[ée]s?$/i, "").trim();
  return `${classLabel || student.className} ${option}`;
}

export function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export function formatPdfDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("fr-FR");
}

export function escapePdfHtml(value: string | number | undefined | null) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function pdfInfoGrid(rows: PdfMetric[], options: { className?: string; columns?: number } = {}) {
  const columns = options.columns ? Math.max(1, Math.floor(options.columns)) : undefined;
  return `
    <div class="info-grid${options.className ? ` ${escapePdfHtml(options.className)}` : ""}"${columns ? ` style="grid-template-columns:repeat(${columns},minmax(0,1fr))"` : ""}>
      ${rows
        .map(
          (row) => `
            <div class="info-box">
              <span>${escapePdfHtml(row.label)}</span>
              <strong>${escapePdfHtml(row.value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

export function pdfTable<T>(columns: PdfTableColumn<T>[], rows: T[], emptyLabel: string, options: { footerHtml?: string } = {}) {
  const renderedRows = rows.map((row, rowIndex) => columns.map((column) => column.render(row, rowIndex)));
  const columnWidths = buildPdfColumnWidths(columns, renderedRows);

  return `
    <table>
      <colgroup>
        ${columnWidths.map((width) => `<col style="width:${width}%" />`).join("")}
      </colgroup>
      <thead>
        <tr>
          ${columns.map((column) => `<th class="${column.align ? `align-${column.align}` : ""}"><span class="cell-inner">${escapePdfHtml(column.header)}</span></th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          renderedRows.length
            ? renderedRows
                .map(
                  (row) => `
                    <tr>
                      ${columns
                        .map((column, columnIndex) => `<td class="${column.align ? `align-${column.align}` : ""}"><span class="cell-inner">${escapePdfHtml(row[columnIndex])}</span></td>`)
                        .join("")}
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="${columns.length}" class="empty-cell"><span class="cell-inner">${escapePdfHtml(emptyLabel)}</span></td></tr>`
        }
      </tbody>
      ${options.footerHtml ? `<tfoot>${options.footerHtml}</tfoot>` : ""}
    </table>
  `;
}

function buildPdfColumnWidths<T>(columns: PdfTableColumn<T>[], renderedRows: Array<Array<string | number>>) {
  if (columns.length === 0) return [];

  const weights = columns.map((column, columnIndex) => {
    const headerWeight = column.header.length * 1.25;
    const contentWeight = renderedRows.reduce((max, row) => {
      const value = String(row[columnIndex] ?? "");
      return Math.max(max, Math.min(value.length, 42));
    }, 0);
    const alignWeight = column.align === "right" || column.align === "center" ? 8 : 0;

    return Math.max(10, headerWeight, contentWeight, alignWeight);
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || columns.length;
  const minimumWidth = columns.length >= 8 ? 8 : columns.length >= 6 ? 10 : 12;

  const rawWidths = weights.map((weight) => (weight / total) * 100);
  const adjustedWidths = rawWidths.map((width) => Math.max(minimumWidth, width));
  const adjustedTotal = adjustedWidths.reduce((sum, width) => sum + width, 0) || 100;

  return adjustedWidths.map((width) => Number(((width / adjustedTotal) * 100).toFixed(2)));
}

export function pdfSection(title: string, bodyHtml: string, options: { pageBreakBefore?: boolean; className?: string } = {}) {
  return `
    ${options.pageBreakBefore ? '<div class="pdf-page-break" aria-hidden="true"></div>' : ""}
    <section class="pdf-section${options.className ? ` ${escapePdfHtml(options.className)}` : ""}">
      <h2>${escapePdfHtml(title)}</h2>
      ${bodyHtml}
    </section>
  `;
}

export async function renderAcadPdfPreview({ filename, title, school, year, subtitle, generatedAt = new Date(), showDocumentTitle = true, centerDocumentTitle = false, pdfSettings, sections, copyLabels, singlePageFit = false }: AcadPdfOptions) {
  const profileEnabled = import.meta.env.DEV || ["staging", "preview"].includes(import.meta.env.VITE_APP_ENV ?? "");
  const profileStart = performance.now();
  const layout = getPdfLayout(pdfSettings);
  const doc = new jsPDF({ unit: "mm", format: layout.jsPdfFormat, orientation: "portrait", compress: true });
  const engineReadyAt = performance.now();
  const viewer = openPdfViewerShell({ filename, title });
  const logoDataUrl = await loadLogoDataUrl(school.logoUrl);
  const resourcesReadyAt = performance.now();
  const element = document.createElement("div");
  element.className = "acadea-pdf";
  const htmlOptions = { title, school, year, subtitle, generatedAt, logoDataUrl, showDocumentTitle, centerDocumentTitle, sections, pdfSettings: layout.settings, renderWidth: layout.windowWidth };
  element.innerHTML = copyLabels
    ? buildTwoCopyPdfHtml({ ...htmlOptions, copyLabels, renderHeight: layout.contentHeight * (layout.windowWidth / layout.contentWidth) })
    : buildPdfHtml(htmlOptions);
  if (!element.textContent?.trim()) {
    showPdfError(viewer, "Le document PDF ne contient aucune donnée à afficher.");
    return;
  }
  element.style.position = "absolute";
  element.style.left = "0";
  element.style.top = "0";
  element.style.zIndex = "-1";
  element.style.pointerEvents = "none";
  document.body.appendChild(element);
  await waitForPdfFonts(element);
  applyPdfPageBreakSpacers(element, layout.contentHeight, layout.windowWidth / layout.contentWidth);
  const contentReadyAt = performance.now();

  try {
    if (singlePageFit) await renderPdfCanvasSinglePage(doc, element, layout);
    else await renderPdfCanvasPages(doc, element, layout);
    if (!copyLabels) addPdfFooters(doc, generatedAt);
    const blob = doc.output("blob") as Blob;
    const blobReadyAt = performance.now();
    const url = URL.createObjectURL(blob);
    showPdfInViewer({ viewer, url, filename, title });
    if (profileEnabled) console.info("[Acadéa PDF performance]", {
      document: title,
      engineMs: Math.round(engineReadyAt - profileStart),
      resourcesMs: Math.round(resourcesReadyAt - engineReadyAt),
      contentAndFontsMs: Math.round(contentReadyAt - resourcesReadyAt),
      renderAndBlobMs: Math.round(blobReadyAt - contentReadyAt),
      totalMs: Math.round(performance.now() - profileStart),
    });
  } catch (error) {
    console.error("Erreur de génération PDF Acadéa", error);
    showPdfError(viewer, "La génération du PDF a échoué.");
  } finally {
    element.remove();
  }
}

async function renderPdfCanvasSinglePage(doc: PdfDoc, element: HTMLElement, layout: ReturnType<typeof getPdfLayout>) {
  const { default: html2canvas } = await import("html2canvas");
  const source = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, windowWidth: layout.windowWidth });
  const maximumHeight = layout.contentHeight;
  const naturalHeight = source.height / source.width * layout.contentWidth;
  const renderedHeight = Math.min(maximumHeight, naturalHeight);
  const renderedWidth = naturalHeight > maximumHeight ? source.width / source.height * maximumHeight : layout.contentWidth;
  const x = layout.margins.left + (layout.contentWidth - renderedWidth) / 2;
  doc.addImage(source.toDataURL("image/png"), "PNG", x, layout.margins.top, renderedWidth, renderedHeight, undefined, "FAST");
}

async function waitForPdfFonts(element: HTMLElement) {
  if (!document.fonts) return;
  await document.fonts.ready;
  const computedStyle = getComputedStyle(element);
  await document.fonts.load(`${computedStyle.fontSize} ${computedStyle.fontFamily}`);
}

async function renderPdfCanvasPages(doc: PdfDoc, element: HTMLElement, layout: ReturnType<typeof getPdfLayout>) {
  const { default: html2canvas } = await import("html2canvas");
  const renderScale = 2;
  const source = await html2canvas(element, {
    scale: renderScale,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: layout.windowWidth,
  });
  const pageHeightPx = Math.round(layout.contentHeight * (layout.windowWidth / layout.contentWidth) * renderScale);
  const protectedRanges = collectPdfProtectedRanges(element, renderScale, pageHeightPx);
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("Canvas PDF source indisponible.");
  let sourceY = 0;
  let pageIndex = 0;

  while (sourceY < source.height) {
    if (pageIndex > 0) doc.addPage();
    const proposedEnd = Math.min(sourceY + pageHeightPx, source.height);
    const protectedEnd = avoidProtectedPdfRangeCut(sourceY, proposedEnd, pageHeightPx, protectedRanges);
    const sliceEnd = protectedEnd < source.height
      ? findPdfWhitespaceCut(sourceContext, source.width, sourceY, protectedEnd, pageHeightPx)
      : protectedEnd;
    const sliceHeight = Math.max(1, sliceEnd - sourceY);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = source.width;
    pageCanvas.height = sliceHeight;
    const context = pageCanvas.getContext("2d");
    if (!context) throw new Error("Canvas PDF indisponible.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(source, 0, sourceY, source.width, sliceHeight, 0, 0, source.width, sliceHeight);
    const renderedHeightMm = sliceHeight / pageHeightPx * layout.contentHeight;
    doc.addImage(pageCanvas.toDataURL("image/png"), "PNG", layout.margins.left, layout.margins.top, layout.contentWidth, renderedHeightMm, undefined, "FAST");
    sourceY = sliceEnd;
    pageIndex += 1;
  }
}

type PdfProtectedRange = { start: number; end: number };

function collectPdfProtectedRanges(element: HTMLElement, renderScale: number, pageHeightPx: number): PdfProtectedRange[] {
  const rootTop = element.getBoundingClientRect().top;
  const selectors = [
    "tr",
    ".info-box",
    ".outgoing-correspondence-content",
    ".outgoing-correspondence-paragraph",
    ".outgoing-signature-row",
    ".report-section",
    ".report-signatures-block",
  ].join(",");
  return Array.from(element.querySelectorAll<HTMLElement>(selectors)).flatMap((node) => {
    const rect = node.getBoundingClientRect();
    const start = Math.max(0, Math.floor((rect.top - rootTop) * renderScale));
    const end = Math.max(start, Math.ceil((rect.bottom - rootTop) * renderScale));
    return end - start > 2 && end - start < pageHeightPx ? [{ start, end }] : [];
  }).sort((a, b) => a.start - b.start);
}

export function avoidProtectedPdfRangeCut(sourceY: number, proposedEnd: number, pageHeightPx: number, ranges: PdfProtectedRange[]) {
  const minimumUsefulSlice = Math.round(pageHeightPx * 0.35);
  const crossingRange = ranges.find((range) => range.start < proposedEnd && range.end > proposedEnd && range.start > sourceY);
  if (!crossingRange || crossingRange.start - sourceY < minimumUsefulSlice) return proposedEnd;
  return crossingRange.start;
}

function findPdfWhitespaceCut(context: CanvasRenderingContext2D, width: number, sourceY: number, proposedEnd: number, pageHeightPx: number) {
  const minimumEnd = Math.max(sourceY + Math.round(pageHeightPx * 0.75), proposedEnd - 120);
  const sampleStep = Math.max(1, Math.floor(width / 500));
  let consecutiveClearRows = 0;
  for (let y = proposedEnd - 1; y >= minimumEnd; y -= 1) {
    const pixels = context.getImageData(0, y, width, 1).data;
    let inkSamples = 0;
    let samples = 0;
    for (let x = 0; x < width; x += sampleStep) {
      const index = x * 4;
      samples += 1;
      if (pixels[index + 3] > 0 && (pixels[index] < 242 || pixels[index + 1] < 242 || pixels[index + 2] < 242)) inkSamples += 1;
    }
    if (inkSamples / Math.max(1, samples) <= 0.005) {
      consecutiveClearRows += 1;
      if (consecutiveClearRows >= 3) return y + consecutiveClearRows;
    } else {
      consecutiveClearRows = 0;
    }
  }
  return proposedEnd;
}

function applyPdfPageBreakSpacers(element: HTMLElement, contentHeightMm: number, pixelsPerMillimeter: number) {
  const pageBreaks = Array.from(element.querySelectorAll<HTMLElement>(".pdf-page-break"));
  if (pageBreaks.length === 0) return;

  const pageHeightPx = pixelsPerMillimeter * contentHeightMm;
  for (const pageBreak of pageBreaks) {
    const offsetInPage = pageBreak.offsetTop % pageHeightPx;
    const spacerHeight = offsetInPage < 1 ? 0 : pageHeightPx - offsetInPage;
    pageBreak.style.height = `${spacerHeight}px`;
  }
}

export async function generateReceiptPdf(payment: Payment, student: Student, feeType: FeeType, school: School, cashierName = payment.cashierName) {
  await renderAcadPdfPreview({
    filename: `recu-${student.matricule}-${payment.id}.pdf`,
    title: "Reçu de paiement",
    school,
    copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE PARENT"],
    sections: [
      pdfInfoGrid([
        { label: "Reçu", value: payment.receiptNumber ?? payment.id.toUpperCase() },
        { label: "Date", value: formatPdfDate(payment.paidAt) },
        { label: "Élève", value: `${student.nom} ${student.postnom} ${student.prenom}`.trim() },
        { label: "Matricule", value: student.matricule },
        { label: "Classe", value: formatStudentClassName(student) },
        { label: "Type de frais", value: feeType.name },
        { label: "Montant payé", value: money(payment.amount) },
        { label: "Caissier", value: cashierName || "-" },
      ]),
      `
        <section class="signature-row">
          <div>
            <span>Signature et cachet</span>
            <strong></strong>
          </div>
        </section>
      `,
    ],
  });
}

type PdfHtmlOptions = {
  title: string;
  school: School;
  year?: SchoolYear;
  subtitle?: string;
  generatedAt: Date;
  logoDataUrl: string;
  showDocumentTitle: boolean;
  centerDocumentTitle: boolean;
  sections: string[];
  pdfSettings: PdfGenerationSettings;
  renderWidth: number;
};

function buildPdfHtml(options: PdfHtmlOptions) {
  return `
    <style>${pdfStyles(options.pdfSettings, options.renderWidth)}</style>
    ${buildPdfContentHtml(options)}
  `;
}

export function buildTwoCopyPdfHtml({ copyLabels, renderHeight, ...options }: PdfHtmlOptions & {
  copyLabels: readonly [string, string];
  renderHeight: number;
}) {
  const renderCopy = (label: string) => `
    <article class="pdf-copy">
      <div class="pdf-copy-content">${buildPdfContentHtml(options, label)}</div>
      <footer class="pdf-copy-footer">Généré par Acadéa | ${escapePdfHtml(options.generatedAt.toLocaleString("fr-FR"))}</footer>
    </article>
  `;

  return `
    <style>${pdfStyles(options.pdfSettings, options.renderWidth)}${twoCopyPdfStyles(renderHeight)}</style>
    <div class="two-copy-page">
      ${renderCopy(copyLabels[0])}
      <div class="pdf-cut-line" aria-label="Ligne de découpe"><span>Découper ici</span></div>
      ${renderCopy(copyLabels[1])}
    </div>
  `;
}

function buildPdfContentHtml({
  title,
  school,
  year,
  subtitle,
  generatedAt,
  logoDataUrl,
  showDocumentTitle,
  centerDocumentTitle,
  sections,
}: PdfHtmlOptions, copyLabel?: string) {
  const schoolMotto = school.motto?.trim();
  return `
    <header class="pdf-header">
      <div class="brand-mark">
        ${
          logoDataUrl
            ? `<img src="${logoDataUrl}" alt="" />`
            : `<span>${escapePdfHtml((school.acronym ?? school.name.slice(0, 1)).toUpperCase())}</span>`
        }
      </div>
      <div class="school-block">
        <h1>${escapePdfHtml(school.name)}</h1>
        ${schoolMotto ? `<p class="school-motto">Devise : ${escapePdfHtml(schoolMotto)}</p>` : ""}
        <p>${escapePdfHtml([school.address, school.phone, school.email].filter(Boolean).join(" | "))}</p>
        ${year ? `<p>Année scolaire : <strong>${escapePdfHtml(year.name)}</strong></p>` : ""}
      </div>
    </header>
    ${copyLabel ? `<div class="pdf-copy-label">${escapePdfHtml(copyLabel)}</div>` : ""}
    ${showDocumentTitle ? `<div class="document-title${centerDocumentTitle ? " document-title--center" : ""}">
      <p>Acadéa</p>
      <h2>${escapePdfHtml(title)}</h2>
      ${subtitle ? `<span>${escapePdfHtml(subtitle)}</span>` : ""}
      <small>Date de génération : ${escapePdfHtml(generatedAt.toLocaleString("fr-FR"))}</small>
    </div>` : ""}
    ${sections.join("")}
  `;
}

function twoCopyPdfStyles(renderHeight: number) {
  return `
    .two-copy-page {
      width: 100%;
      height: ${Math.max(0, renderHeight - 2)}px;
      display: grid;
      grid-template-rows: minmax(0, 1fr) 22px minmax(0, 1fr);
      overflow: hidden;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-copy {
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-copy-content { min-height: 0; }
    .pdf-copy-label {
      margin: 5px 12px 0;
      color: #2a9d8f;
      font-size: 7.5px;
      font-weight: 800;
      letter-spacing: normal;
      word-spacing: 0.12em;
      white-space: nowrap;
      word-break: normal;
      overflow-wrap: normal;
      text-align: right;
      text-transform: uppercase;
    }
    .pdf-copy .pdf-header {
      min-height: 40px;
      gap: 8px;
      padding: 6px 12px;
      border-bottom-width: 2px;
    }
    .pdf-copy .brand-mark { width: 34px; height: 34px; font-size: 14px; }
    .pdf-copy .school-block h1 { margin-bottom: 1px; font-size: 13px; line-height: 1.08; }
    .pdf-copy .school-block p { margin: 1px 0; font-size: 7px; line-height: 1.12; }
    .pdf-copy .document-title { margin: 4px 12px 5px; padding: 4px 7px; }
    .pdf-copy .document-title p { font-size: 6.5px; }
    .pdf-copy .document-title h2 { font-size: 11.5px; line-height: 1.12; }
    .pdf-copy .document-title span,
    .pdf-copy .document-title small { margin-top: 2px; font-size: 7px; }
    .pdf-copy .pdf-section {
      margin: 0 12px 5px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-copy .pdf-section h2 { margin-bottom: 4px; padding-bottom: 3px; font-size: 9pt; }
    .pdf-copy .info-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px 6px;
      margin-bottom: 4px;
    }
    .pdf-copy .info-box { min-height: 35px; padding: 6px 6px; }
    .pdf-copy .info-box span { font-size: 6.5px; line-height: 1.2; }
    .pdf-copy .info-box strong { margin-top: 2px; font-size: 8.5px; line-height: 1.22; }
    .pdf-copy .signature-row { margin: 5px 12px 0; }
    .pdf-copy .signature-row div { width: 170px; font-size: 7.5px; }
    .pdf-copy .signature-row strong { margin-top: 18px; }
    .pdf-copy-footer {
      margin: auto 12px 4px;
      padding-top: 3px;
      border-top: 1px solid #dbe4ef;
      color: #64748b;
      font-size: 6.5px;
      line-height: 1.1;
    }
    .pdf-cut-line {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      font-size: 6.5px;
    }
    .pdf-cut-line::before {
      position: absolute;
      left: 12px;
      right: 12px;
      top: 50%;
      border-top: 1px dashed #94a3b8;
      content: "";
    }
    .pdf-cut-line span {
      position: relative;
      padding: 0 7px;
      background: #ffffff;
    }
  `;
}

function pdfStyles(pdfSettings: PdfGenerationSettings, renderWidth: number) {
  const fontFamily = resolvePdfFont(pdfSettings.fontFamily);
  const institutionalFontFamily = resolvePdfFont("Aptos");
  return `
    .acadea-pdf {
      width: ${renderWidth}px;
      box-sizing: border-box;
      background: #ffffff;
      color: #14213d;
      font-family: ${fontFamily};
      font-size: ${pdfSettings.fontSize}pt;
      line-height: ${pdfSettings.lineSpacing};
      letter-spacing: normal;
      word-spacing: 0.12em;
      text-rendering: geometricPrecision;
      font-kerning: normal;
      padding: 0;
    }
    .acadea-pdf * {
      box-sizing: border-box;
      letter-spacing: normal !important;
      word-spacing: 0.12em !important;
      white-space: normal;
      word-break: normal;
      overflow-wrap: anywhere;
      hyphens: none;
    }
    .pdf-header {
      display: flex;
      gap: 12px;
      align-items: center;
      min-height: 54px;
      padding: 14px 18px;
      color: #ffffff;
      background: #14213d;
      border-bottom: 3px solid #2a9d8f;
      font-family: ${institutionalFontFamily};
      font-size: 10pt;
      line-height: 1.2;
      letter-spacing: normal;
      word-spacing: normal;
    }
    .pdf-header * {
      font-family: inherit;
      letter-spacing: normal;
      word-spacing: normal;
    }
    .brand-mark {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border: 2px solid rgba(255,255,255,0.55);
      background: #ffffff;
      color: #14213d;
      font-size: 18px;
      font-weight: 800;
      flex: 0 0 auto;
    }
    .brand-mark img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .school-block h1 {
      margin: 0 0 3px;
      font-size: 18px;
      line-height: 1.18;
    }
    .school-block p {
      margin: 2px 0;
      color: #e5edf6;
      font-size: 9.5px;
      line-height: 1.35;
    }
    .school-block .school-motto {
      font-weight: 700;
    }
    .document-title {
      margin: 14px 18px 12px;
      padding: 10px 12px;
      border: 1px solid #dbe4ef;
      background: #f8fafc;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .document-title p {
      margin: 0 0 2px;
      color: #2a9d8f;
      font-size: 8.5px;
      font-weight: 800;
      letter-spacing: normal;
      word-spacing: normal;
      text-transform: uppercase;
    }
    .document-title h2 {
      margin: 0;
      color: #14213d;
      font-size: 17px;
      line-height: 1.28;
    }
    .document-title span,
    .document-title small {
      display: block;
      margin-top: 4px;
      color: #526173;
      font-size: 9.5px;
    }
    .pdf-section {
      margin: 0 18px 12px;
      page-break-inside: auto;
      break-inside: auto;
    }
    .medical-record-pdf .pdf-section { margin-bottom: 6px; }
    .medical-record-pdf .pdf-section h2 { margin-bottom: 4px; padding-bottom: 3px; font-size: 9.5pt; }
    .medical-record-pdf .info-grid { gap: 5px 7px; margin-bottom: 3px; }
    .medical-record-pdf .info-box { min-height: 34px; padding: 5px 7px; }
    .medical-record-pdf .info-box span { font-size: 7.5px; }
    .medical-record-pdf .info-box strong { margin-top: 2px; font-size: 9px; line-height: 1.2; }
    .document-title--center { text-align: center; }
    .document-title--center h2 {
      font-weight: 800;
      letter-spacing: normal;
      word-spacing: normal;
      white-space: nowrap;
      overflow-wrap: normal;
    }
    .pdf-page-break {
      display: block;
      height: 0;
      margin: 0;
      padding: 0;
      line-height: 0;
      page-break-before: always;
      break-before: page;
    }
    .pdf-section h2 {
      margin: 0 0 7px;
      padding-bottom: 5px;
      border-bottom: 1px solid #dbe4ef;
      color: #14213d;
      font-size: ${pdfSettings.fontSize + 1.5}pt;
      font-weight: 800;
      line-height: 1.35;
      page-break-after: avoid;
      break-after: avoid-page;
      letter-spacing: normal;
      word-spacing: normal;
      overflow-wrap: normal;
    }
    .pdf-section.statistics-pdf-section h2 {
      font-family: ${institutionalFontFamily};
      letter-spacing: normal;
      word-spacing: normal;
      white-space: normal;
      overflow-wrap: normal;
      text-rendering: geometricPrecision;
      font-kerning: normal;
      font-variant-ligatures: normal;
    }
    .pdf-section.statistics-summary-pdf-section .info-grid {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 5px;
    }
    .pdf-section.statistics-summary-pdf-section .info-box {
      min-height: 48px;
      padding: 6px 5px;
    }
    .pdf-section.statistics-summary-pdf-section .info-box span {
      font-size: 7.5px;
      line-height: 1.15;
    }
    .pdf-section.statistics-summary-pdf-section .info-box strong {
      font-size: 11px;
      line-height: 1.15;
    }
    .pdf-section.report-section {
      margin-top: 16px;
    }
    .pdf-section.report-section h2 {
      margin-bottom: 4px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .personnel-photo { display:flex; justify-content:center; margin:0 18px 12px; }
    .personnel-photo img { width:30mm; height:38mm; object-fit:cover; border:1px solid #dbe4ef; border-radius:3px; }
    .report-info-row .info-grid {
      grid-template-columns: repeat(${pdfSettings.pageSize === "A5" ? 2 : 4}, minmax(0, 1fr));
      gap: 5px;
      margin: 0 18px 12px;
    }
    .report-info-row .info-box {
      min-width: 0;
      padding: 6px 5px;
    }
    .report-info-row .info-box strong {
      font-size: 8.5px;
      overflow-wrap: anywhere;
    }
    .report-justified-text {
      margin: 0;
      text-align: justify;
      text-justify: inter-word;
      line-height: ${pdfSettings.lineSpacing};
    }
    .secretary-pdf-main-text {
      font-family: ${fontFamily};
      font-size: ${pdfSettings.fontSize}pt;
      line-height: ${pdfSettings.lineSpacing};
    }
    .report-signatories {
      display: grid;
      gap: 42px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .report-signatory-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
      align-items: end;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .report-signatory-row--1 .report-signatory {
      grid-column: 2;
    }
    .report-signatory-row--2 .report-signatory:first-child {
      grid-column: 1;
    }
    .report-signatory-row--2 .report-signatory:last-child {
      grid-column: 3;
    }
    .pdf-section:has(.report-signatories) {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .report-signatory {
      min-width: 0;
      padding-top: 42px;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .report-signatory span {
      display: block;
      overflow-wrap: anywhere;
    }
    .report-signatory-name { font-weight: 700; }
    .report-signatory-function { margin-top: 2px; }
    .report-signatures-block {
      margin: 28px 18px 0;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .info-box {
      min-height: 36px;
      padding: 8px 9px;
      border: 1px solid #dbe4ef;
      background: #ffffff;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .info-box span {
      display: block;
      color: #64748b;
      font-size: 8px;
      line-height: 1.35;
      text-transform: uppercase;
    }
    .info-box strong {
      display: block;
      margin-top: 3px;
      color: #14213d;
      font-size: 10.5px;
      line-height: 1.42;
      overflow-wrap: anywhere;
    }
    table {
      width: 100%;
      max-width: 100%;
      border-collapse: collapse;
      table-layout: auto;
      margin-top: 6px;
      font-size: 9.5px;
      line-height: 1.42;
      page-break-inside: auto;
    }
    thead {
      display: table-header-group;
    }
    tbody {
      display: table-row-group;
    }
    th {
      padding: 6px 7px;
      border: 1px solid #b8c4d4;
      background: #14213d;
      color: #ffffff;
      font-size: 8px;
      line-height: 1.34;
      text-transform: uppercase;
      overflow-wrap: anywhere;
      word-spacing: normal;
      vertical-align: middle !important;
    }
    td {
      padding: 6px 7px;
      border: 1px solid #dbe4ef;
      color: #26364b;
      vertical-align: middle !important;
      overflow-wrap: anywhere;
      word-break: normal;
      line-height: 1.45;
    }
    .cell-inner {
      display: flex;
      min-height: 18px;
      width: 100%;
      align-items: center;
      justify-content: flex-start;
      line-height: 1.45;
      overflow-wrap: anywhere;
      word-break: normal;
      white-space: normal;
    }
    th .cell-inner {
      min-height: 16px;
      line-height: 1.34;
    }
    tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    tbody tr:nth-child(even) td {
      background: #f8fafc;
    }
    tfoot td {
      background: #eef6f4;
      color: #14213d;
      font-weight: 800;
      text-align: center !important;
      vertical-align: middle !important;
      padding-top: 7px;
      padding-bottom: 7px;
      line-height: 1.45;
      word-spacing: normal;
    }
    tfoot .cell-inner,
    tfoot td {
      align-items: center;
      justify-content: center;
      text-align: center !important;
    }
    .align-right {
      text-align: right;
    }
    .align-right .cell-inner {
      justify-content: flex-end;
      text-align: right;
    }
    .align-center {
      text-align: center;
    }
    .align-center .cell-inner,
    .empty-cell .cell-inner {
      justify-content: center;
      text-align: center;
    }
    .empty-cell {
      padding: 14px;
      text-align: center;
      vertical-align: middle !important;
      color: #64748b;
    }
    .highlight-box {
      padding: 10px 12px;
      border: 1px solid #c7d7e5;
      background: #f8fafc;
      color: #14213d;
      font-weight: 700;
      line-height: 1.45;
      display: flex;
      align-items: center;
    }
    .signature-row {
      margin: 22px 18px 0;
      display: flex;
      justify-content: flex-end;
    }
    .signature-row div {
      width: 210px;
      text-align: center;
      color: #475569;
      font-size: 9.5px;
    }
    .signature-row strong {
      display: block;
      margin-top: 32px;
      border-top: 1px solid #14213d;
      height: 1px;
    }
    .outgoing-signature-row {
      margin: 36px 18px 0;
      display: grid;
      gap: 10px;
      justify-items: end;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .outgoing-visa-note {
      width: min(100%, 320px);
      margin-right: auto;
      color: #475569;
      font-size: 9.5px;
      line-height: 1.35;
    }
    .outgoing-signature-block {
      width: min(100%, 240px);
      color: #14213d;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .outgoing-signature-space,
    .outgoing-signatory-name,
    .outgoing-signatory-function,
    .outgoing-signatory-stamp {
      display: block;
    }
    .outgoing-signatory-name {
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .outgoing-signatory-function {
      margin-top: 2px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .outgoing-signatory-stamp {
      margin-top: 4px;
      color: #475569;
      font-size: 9.5px;
    }
  `;
}

function addPdfFooters(doc: PdfDoc, generatedAt: Date) {
  const pages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight?.() ?? 297;

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(220, 226, 235);
    doc.line(16, pageHeight - 14, pageWidth - 16, pageHeight - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Généré par Acadéa | ${generatedAt.toLocaleString("fr-FR")}`, 16, pageHeight - 8);
    doc.text(`Page ${page} / ${pages}`, pageWidth - 38, pageHeight - 8);
  }
}

function openPdfViewerShell({ filename, title }: { filename: string; title: string }) {
  const overlay = document.createElement("div");
  overlay.className = "acadea-pdf-viewer";
  overlay.innerHTML = `
    <style>
      .acadea-pdf-viewer {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: #0f172a;
        color: #e2e8f0;
        font-family: "Noto Sans", "DejaVu Sans", "Segoe UI", Arial, Helvetica, sans-serif;
      }
      .acadea-pdf-viewer * { box-sizing: border-box; }
      .acadea-pdf-viewer__toolbar {
        display: flex;
        min-height: 58px;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 14px;
        background: #14213d;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .acadea-pdf-viewer__title { min-width: 0; }
      .acadea-pdf-viewer__title strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
      }
      .acadea-pdf-viewer__title span { color: #94a3b8; font-size: 12px; }
      .acadea-pdf-viewer__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .acadea-pdf-viewer button,
      .acadea-pdf-viewer a {
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.08);
        color: #ffffff;
        padding: 8px 10px;
        font: inherit;
        font-size: 13px;
        text-decoration: none;
        cursor: pointer;
      }
      .acadea-pdf-viewer button:hover,
      .acadea-pdf-viewer a:hover { background: rgba(255,255,255,0.16); }
      .acadea-pdf-viewer__body {
        height: calc(100vh - 58px);
        overflow: auto;
        padding: 18px;
      }
      .acadea-pdf-viewer__loading {
        display: flex;
        min-height: calc(100vh - 96px);
        align-items: center;
        justify-content: center;
        color: #cbd5e1;
        font-size: 15px;
      }
      .acadea-pdf-viewer__mobile-message {
        display: none;
        margin-bottom: 10px;
        border: 1px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.08);
        color: #e2e8f0;
        padding: 10px 12px;
        font-size: 13px;
        line-height: 1.4;
      }
      .acadea-pdf-viewer iframe {
        display: none;
        width: 100%;
        height: calc(100vh - 96px);
        border: 0;
        background: #ffffff;
        transform-origin: top center;
        margin: 0 auto;
      }
      .acadea-pdf-viewer__actions [disabled],
      .acadea-pdf-viewer__actions [aria-disabled="true"] {
        cursor: wait;
        opacity: 0.5;
        pointer-events: none;
      }
      @media (max-width: 720px) {
        .acadea-pdf-viewer__toolbar { align-items: flex-start; flex-direction: column; }
        .acadea-pdf-viewer__actions { width: 100%; justify-content: flex-start; }
        .acadea-pdf-viewer__actions a,
        .acadea-pdf-viewer__actions button { flex: 1 1 44%; text-align: center; }
        .acadea-pdf-viewer__body { padding: 8px; }
        .acadea-pdf-viewer iframe { height: calc(100vh - 154px); }
      }
    </style>
    <div class="acadea-pdf-viewer__toolbar">
      <div class="acadea-pdf-viewer__title">
        <strong>${escapePdfHtml(title)}</strong>
        <span>Aperçu PDF Acadéa</span>
      </div>
      <div class="acadea-pdf-viewer__actions">
        <a data-pdf-open href="#" target="_blank" rel="noopener" aria-disabled="true">Ouvrir le PDF</a>
        <a data-pdf-download href="#" download="${escapePdfHtml(filename)}" target="_blank" rel="noopener" aria-disabled="true">Télécharger</a>
        <button type="button" data-pdf-print disabled>Imprimer</button>
        <button type="button" data-pdf-zoom-out disabled>-</button>
        <button type="button" data-pdf-zoom-in disabled>+</button>
        <button type="button" data-pdf-close>Fermer</button>
      </div>
    </div>
    <div class="acadea-pdf-viewer__body">
      <div class="acadea-pdf-viewer__loading" data-pdf-loading>Génération du PDF...</div>
      <div class="acadea-pdf-viewer__mobile-message" data-pdf-mobile-message>
        Si l'aperçu ne s'affiche pas sur ce téléphone, ouvrez le document avec le lecteur PDF de l'appareil ou utilisez le bouton Télécharger.
      </div>
      <iframe data-pdf-frame title="${escapePdfHtml(title)}"></iframe>
    </div>
  `;

  document.body.appendChild(overlay);
  const frame = overlay.querySelector<HTMLIFrameElement>("[data-pdf-frame]");
  const loading = overlay.querySelector<HTMLElement>("[data-pdf-loading]");
  const mobileMessage = overlay.querySelector<HTMLElement>("[data-pdf-mobile-message]");
  const openButton = overlay.querySelector<HTMLAnchorElement>("[data-pdf-open]");
  const download = overlay.querySelector<HTMLAnchorElement>("[data-pdf-download]");
  const printButton = overlay.querySelector<HTMLButtonElement>("[data-pdf-print]");
  const zoomOut = overlay.querySelector<HTMLButtonElement>("[data-pdf-zoom-out]");
  const zoomIn = overlay.querySelector<HTMLButtonElement>("[data-pdf-zoom-in]");
  const close = overlay.querySelector<HTMLButtonElement>("[data-pdf-close]");
  let zoom = 1;

  close?.addEventListener("click", () => overlay.remove());
  printButton?.addEventListener("click", () => {
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  });
  zoomOut?.addEventListener("click", () => {
    if (!frame) return;
    zoom = Math.max(0.6, zoom - 0.1);
    frame.style.transform = `scale(${zoom})`;
    frame.style.width = `${100 / zoom}%`;
  });
  zoomIn?.addEventListener("click", () => {
    if (!frame) return;
    zoom = Math.min(1.8, zoom + 0.1);
    frame.style.transform = `scale(${zoom})`;
    frame.style.width = `${100 / zoom}%`;
  });

  return { overlay, frame, loading, mobileMessage, openButton, download, printButton, zoomOut, zoomIn };
}

function showPdfInViewer({
  viewer,
  url,
}: {
  viewer: ReturnType<typeof openPdfViewerShell>;
  url: string;
  filename: string;
  title: string;
}) {
  const isMobile = isMobilePdfDevice();
  if (viewer.loading) viewer.loading.style.display = "none";
  if (viewer.openButton) {
    viewer.openButton.href = url;
    viewer.openButton.setAttribute("aria-disabled", "false");
    viewer.openButton.addEventListener("click", (event) => {
      event.preventDefault();
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = url;
    });
  }
  if (viewer.download) {
    viewer.download.href = url;
    viewer.download.setAttribute("aria-disabled", "false");
  }
  if (isMobile) {
    viewer.frame?.removeAttribute("src");
    viewer.frame?.style.setProperty("display", "none");
    if (viewer.mobileMessage) viewer.mobileMessage.style.display = "block";
  } else {
    viewer.frame?.addEventListener(
      "load",
      () => {
        if (viewer.mobileMessage) viewer.mobileMessage.style.display = "none";
      },
      { once: true },
    );
    viewer.frame?.setAttribute("src", url);
    if (viewer.frame) viewer.frame.style.display = "block";
    viewer.printButton?.removeAttribute("disabled");
    viewer.zoomOut?.removeAttribute("disabled");
    viewer.zoomIn?.removeAttribute("disabled");
  }
  viewer.overlay.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest("[data-pdf-close]")) return;
    URL.revokeObjectURL(url);
  });
}

function showPdfError(viewer: ReturnType<typeof openPdfViewerShell>, message: string) {
  if (viewer.loading) {
    viewer.loading.textContent = message;
    viewer.loading.style.display = "flex";
  }
}

function isMobilePdfDevice() {
  const userAgent = navigator.userAgent || "";
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;

  return mobileUserAgent || (coarsePointer && window.innerWidth <= 900);
}

const logoDataUrlCache = new Map<string, Promise<string>>();

async function fetchLogoDataUrl(logoUrl: string) {
  const response = await fetch(logoUrl);
  if (!response.ok) return "";
  const blob = await response.blob();
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

async function loadLogoDataUrl(logoUrl?: string) {
  if (!logoUrl) return "";
  const cached = logoDataUrlCache.get(logoUrl);
  if (cached) return cached;
  const request = fetchLogoDataUrl(logoUrl).catch(() => "");
  logoDataUrlCache.set(logoUrl, request);
  return request;
}
