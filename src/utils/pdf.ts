import jsPDF from "jspdf";
import type { FeeType, Payment, School, SchoolYear, Student } from "../types";

type PdfDoc = jsPDF & {
  html: (
    source: HTMLElement,
    options: {
      callback: (doc: PdfDoc) => void;
      margin: [number, number, number, number];
      autoPaging: "text" | "slice";
      width: number;
      windowWidth: number;
      html2canvas?: { scale?: number; useCORS?: boolean; backgroundColor?: string };
    },
  ) => void;
  output: (type: "bloburl" | "blob") => URL | string | Blob;
  getNumberOfPages: () => number;
  setPage: (pageNumber: number) => void;
};

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
  sections: string[];
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

export function pdfInfoGrid(rows: PdfMetric[]) {
  return `
    <div class="info-grid">
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

export function pdfSection(title: string, bodyHtml: string) {
  return `
    <section class="pdf-section">
      <h2>${escapePdfHtml(title)}</h2>
      ${bodyHtml}
    </section>
  `;
}

export async function renderAcadPdfPreview({ filename, title, school, year, subtitle, generatedAt = new Date(), sections }: AcadPdfOptions) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true }) as PdfDoc;
  const viewer = openPdfViewerShell({ filename, title });
  const logoDataUrl = await loadLogoDataUrl(school.logoUrl);
  const element = document.createElement("div");
  element.className = "acadea-pdf";
  element.innerHTML = buildPdfHtml({ title, school, year, subtitle, generatedAt, logoDataUrl, sections });
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

  await new Promise<void>((resolve) => {
    try {
      doc.html(element, {
        margin: [14, 14, 18, 14],
        autoPaging: "text",
        width: 182,
        windowWidth: 688,
        html2canvas: {
          useCORS: true,
          backgroundColor: "#ffffff",
        },
        callback: (pdf) => {
          addPdfFooters(pdf, generatedAt);
          const blob = pdf.output("blob") as Blob;
          const url = URL.createObjectURL(blob);
          showPdfInViewer({ viewer, url, filename, title });
          element.remove();
          resolve();
        },
      });
    } catch (error) {
      console.error("Erreur de génération PDF Acadéa", error);
      showPdfError(viewer, "La génération du PDF a échoué.");
      element.remove();
      resolve();
    }
  });
}

export async function generateReceiptPdf(payment: Payment, student: Student, feeType: FeeType, school: School, cashierName = payment.cashierName) {
  await renderAcadPdfPreview({
    filename: `recu-${student.matricule}-${payment.id}.pdf`,
    title: "Reçu de paiement",
    school,
    subtitle: `Devise : Dollar américain (${school.currency})`,
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

function buildPdfHtml({
  title,
  school,
  year,
  subtitle,
  generatedAt,
  logoDataUrl,
  sections,
}: {
  title: string;
  school: School;
  year?: SchoolYear;
  subtitle?: string;
  generatedAt: Date;
  logoDataUrl: string;
  sections: string[];
}) {
  return `
    <style>${pdfStyles()}</style>
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
        <p>${escapePdfHtml([school.address, school.phone, school.email].filter(Boolean).join(" | "))}</p>
        ${year ? `<p>Année scolaire : <strong>${escapePdfHtml(year.name)}</strong></p>` : ""}
      </div>
    </header>
    <div class="document-title">
      <p>Acadéa</p>
      <h2>${escapePdfHtml(title)}</h2>
      ${subtitle ? `<span>${escapePdfHtml(subtitle)}</span>` : ""}
      <small>Date de génération : ${escapePdfHtml(generatedAt.toLocaleString("fr-FR"))}</small>
    </div>
    ${sections.join("")}
  `;
}

function pdfStyles() {
  return `
    .acadea-pdf {
      width: 688px;
      box-sizing: border-box;
      background: #ffffff;
      color: #14213d;
      font-family: Arial, "Segoe UI", "Noto Sans", "DejaVu Sans", Helvetica, sans-serif;
      font-size: 11.5px;
      line-height: 1.48;
      letter-spacing: normal;
      word-spacing: 0.06em;
      text-rendering: geometricPrecision;
      font-kerning: normal;
      padding: 0;
    }
    .acadea-pdf * {
      box-sizing: border-box;
      letter-spacing: normal;
      word-spacing: inherit;
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
      letter-spacing: 0.04em;
      word-spacing: 0.08em;
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
    .pdf-section h2 {
      margin: 0 0 7px;
      padding-bottom: 5px;
      border-bottom: 1px solid #dbe4ef;
      color: #14213d;
      font-size: 12.5px;
      line-height: 1.35;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
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
      word-spacing: 0.08em;
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
      word-spacing: 0.08em;
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

async function loadLogoDataUrl(logoUrl?: string) {
  if (!logoUrl) return "";

  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return "";
    const blob = await response.blob();

    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}
