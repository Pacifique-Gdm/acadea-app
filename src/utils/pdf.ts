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

export function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export function formatPdfDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("fr-FR");
}

export function escapePdfHtml(value: string | number | undefined | null) {
  return String(value ?? "")
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
  return `
    <table>
      <thead>
        <tr>
          ${columns.map((column) => `<th class="${column.align ? `align-${column.align}` : ""}">${escapePdfHtml(column.header)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (row, index) => `
                    <tr>
                      ${columns
                        .map((column) => `<td class="${column.align ? `align-${column.align}` : ""}">${escapePdfHtml(column.render(row, index))}</td>`)
                        .join("")}
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="${columns.length}" class="empty-cell">${escapePdfHtml(emptyLabel)}</td></tr>`
        }
      </tbody>
      ${options.footerHtml ? `<tfoot>${options.footerHtml}</tfoot>` : ""}
    </table>
  `;
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
  element.style.position = "fixed";
  element.style.left = "-10000px";
  element.style.top = "0";
  document.body.appendChild(element);

  await new Promise<void>((resolve) => {
    doc.html(element, {
      margin: [10, 10, 18, 10],
      autoPaging: "text",
      width: 190,
      windowWidth: 794,
      html2canvas: {
        scale: 0.24,
        useCORS: true,
        backgroundColor: "#ffffff",
      },
      callback: (pdf) => {
        addPdfFooters(pdf, generatedAt);
        const url = pdf.output("bloburl").toString();
        showPdfInViewer({ viewer, url, filename, title });
        element.remove();
        resolve();
      },
    });
  });
}

export async function generateReceiptPdf(payment: Payment, student: Student, feeType: FeeType, school: School) {
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
        { label: "Classe", value: student.className },
        { label: "Type de frais", value: feeType.name },
        { label: "Montant payé", value: money(payment.amount) },
        { label: "Caissier", value: payment.cashierName },
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
      width: 794px;
      box-sizing: border-box;
      background: #ffffff;
      color: #14213d;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.45;
      padding: 0;
    }
    .pdf-header {
      display: flex;
      gap: 18px;
      align-items: center;
      padding: 24px 28px;
      color: #ffffff;
      background: #14213d;
      border-bottom: 5px solid #2a9d8f;
    }
    .brand-mark {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 68px;
      height: 68px;
      border: 2px solid rgba(255,255,255,0.55);
      background: #ffffff;
      color: #14213d;
      font-size: 28px;
      font-weight: 800;
      flex: 0 0 auto;
    }
    .brand-mark img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .school-block h1 {
      margin: 0 0 6px;
      font-size: 25px;
      line-height: 1.1;
    }
    .school-block p {
      margin: 2px 0;
      color: #e5edf6;
      font-size: 11px;
    }
    .document-title {
      margin: 22px 28px 18px;
      padding: 16px 18px;
      border: 1px solid #dbe4ef;
      background: #f8fafc;
    }
    .document-title p {
      margin: 0 0 3px;
      color: #2a9d8f;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .document-title h2 {
      margin: 0;
      color: #14213d;
      font-size: 22px;
      line-height: 1.2;
    }
    .document-title span,
    .document-title small {
      display: block;
      margin-top: 5px;
      color: #526173;
      font-size: 11px;
    }
    .pdf-section {
      margin: 0 28px 18px;
      page-break-inside: avoid;
    }
    .pdf-section h2 {
      margin: 0 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #dbe4ef;
      color: #14213d;
      font-size: 15px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .info-box {
      min-height: 48px;
      padding: 10px 12px;
      border: 1px solid #dbe4ef;
      background: #ffffff;
      box-sizing: border-box;
    }
    .info-box span {
      display: block;
      color: #64748b;
      font-size: 10px;
      text-transform: uppercase;
    }
    .info-box strong {
      display: block;
      margin-top: 4px;
      color: #14213d;
      font-size: 13px;
      word-break: break-word;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 8px;
      font-size: 10px;
    }
    th {
      padding: 8px 7px;
      border: 1px solid #b8c4d4;
      background: #14213d;
      color: #ffffff;
      font-size: 9px;
      line-height: 1.25;
      text-transform: uppercase;
    }
    td {
      padding: 8px 7px;
      border: 1px solid #dbe4ef;
      color: #26364b;
      vertical-align: top;
      word-break: break-word;
    }
    tbody tr:nth-child(even) td {
      background: #f8fafc;
    }
    tfoot td {
      background: #eef6f4;
      color: #14213d;
      font-weight: 800;
    }
    .align-right {
      text-align: right;
    }
    .align-center {
      text-align: center;
    }
    .empty-cell {
      padding: 18px;
      text-align: center;
      color: #64748b;
    }
    .highlight-box {
      padding: 12px 14px;
      border: 1px solid #c7d7e5;
      background: #f8fafc;
      color: #14213d;
      font-weight: 700;
    }
    .signature-row {
      margin: 30px 28px 0;
      display: flex;
      justify-content: flex-end;
    }
    .signature-row div {
      width: 220px;
      text-align: center;
      color: #475569;
      font-size: 11px;
    }
    .signature-row strong {
      display: block;
      margin-top: 42px;
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
    doc.line(10, pageHeight - 12, pageWidth - 10, pageHeight - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Généré par Acadéa | ${generatedAt.toLocaleString("fr-FR")}`, 10, pageHeight - 7);
    doc.text(`Page ${page} / ${pages}`, pageWidth - 32, pageHeight - 7);
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
        font-family: Arial, Helvetica, sans-serif;
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
        .acadea-pdf-viewer__actions { justify-content: flex-start; }
        .acadea-pdf-viewer__body { padding: 8px; }
      }
    </style>
    <div class="acadea-pdf-viewer__toolbar">
      <div class="acadea-pdf-viewer__title">
        <strong>${escapePdfHtml(title)}</strong>
        <span>Aperçu PDF Acadéa</span>
      </div>
      <div class="acadea-pdf-viewer__actions">
        <a data-pdf-download href="#" download="${escapePdfHtml(filename)}" aria-disabled="true">Télécharger</a>
        <button type="button" data-pdf-print disabled>Imprimer</button>
        <button type="button" data-pdf-zoom-out disabled>-</button>
        <button type="button" data-pdf-zoom-in disabled>+</button>
        <button type="button" data-pdf-close>Fermer</button>
      </div>
    </div>
    <div class="acadea-pdf-viewer__body">
      <div class="acadea-pdf-viewer__loading" data-pdf-loading>Génération du PDF...</div>
      <iframe data-pdf-frame title="${escapePdfHtml(title)}"></iframe>
    </div>
  `;

  document.body.appendChild(overlay);
  const frame = overlay.querySelector<HTMLIFrameElement>("[data-pdf-frame]");
  const loading = overlay.querySelector<HTMLElement>("[data-pdf-loading]");
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

  return { overlay, frame, loading, download, printButton, zoomOut, zoomIn };
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
  viewer.frame?.setAttribute("src", url);
  if (viewer.frame) viewer.frame.style.display = "block";
  if (viewer.loading) viewer.loading.style.display = "none";
  if (viewer.download) {
    viewer.download.href = url;
    viewer.download.setAttribute("aria-disabled", "false");
  }
  viewer.printButton?.removeAttribute("disabled");
  viewer.zoomOut?.removeAttribute("disabled");
  viewer.zoomIn?.removeAttribute("disabled");
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
