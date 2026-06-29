function escapePdfHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pdfInfoGrid(rows) {
  return `
    <div class="info-grid">
      ${rows.map((row) => `<div class="info-box"><span>${escapePdfHtml(row.label)}</span><strong>${escapePdfHtml(row.value)}</strong></div>`).join("")}
    </div>
  `;
}

function pdfTable(columns, rows, emptyLabel) {
  const renderedRows = rows.map((row, index) => columns.map((column) => column.render(row, index)));
  const widths = buildColumnWidths(columns, renderedRows);

  return `
    <table>
      <colgroup>${widths.map((width) => `<col style="width:${width}%" />`).join("")}</colgroup>
      <thead><tr>${columns.map((column) => `<th>${escapePdfHtml(column.header)}</th>`).join("")}</tr></thead>
      <tbody>
        ${
          renderedRows.length
            ? renderedRows.map((row) => `<tr>${row.map((value) => `<td>${escapePdfHtml(value)}</td>`).join("")}</tr>`).join("")
            : `<tr><td colspan="${columns.length}" class="empty-cell">${escapePdfHtml(emptyLabel)}</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function buildColumnWidths(columns, renderedRows) {
  const weights = columns.map((column, columnIndex) => {
    const headerWeight = column.header.length * 1.25;
    const contentWeight = renderedRows.reduce((max, row) => Math.max(max, Math.min(String(row[columnIndex] ?? "").length, 42)), 0);
    return Math.max(10, headerWeight, contentWeight);
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || columns.length;

  return weights.map((weight) => Number(((weight / total) * 100).toFixed(2)));
}

function pdfSection(title, bodyHtml) {
  return `<section class="pdf-section"><h2>${escapePdfHtml(title)}</h2>${bodyHtml}</section>`;
}

function buildPdfHtml({ title, school, year, subtitle, sections }) {
  return `
    <style>
      .acadea-pdf { width: 688px; background: #ffffff; color: #14213d; font-size: 11.5px; line-height: 1.38; }
      .pdf-header { min-height: 54px; padding: 14px 18px; }
      .document-title { margin: 14px 18px 12px; padding: 10px 12px; }
      .pdf-section { margin: 0 18px 12px; }
      .info-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: auto; font-size: 9.2px; }
      thead { display: table-header-group; }
      th { background: #14213d; color: #ffffff; padding: 5px 6px; overflow-wrap: anywhere; }
      td { color: #26364b; padding: 5px 6px; overflow-wrap: anywhere; }
    </style>
    <header class="pdf-header">
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
    </div>
    ${sections.join("")}
  `;
}

function listTemplateIssues(html, { requireTable = false } = {}) {
  const issues = [];
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, "").trim();

  if (!text) issues.push("Le HTML ne contient aucun texte.");
  if (requireTable && !html.includes("<table")) issues.push("Le HTML ne contient aucun tableau.");
  if (html.includes("<table") && !/table\s*\{[^}]*width:\s*100%/i.test(html)) issues.push("Les tableaux ne sont pas configurés en pleine largeur.");
  if (html.includes("<table") && /table-layout:\s*fixed/i.test(html)) issues.push("Les colonnes de tableau sont forcées au lieu de s'adapter au contenu.");
  if (html.includes("<table") && !html.includes("<colgroup>")) issues.push("Les tableaux ne déclarent pas de largeurs de colonnes adaptées au contenu.");
  if (!/\.acadea-pdf\s*\{[^}]*width:\s*688px/i.test(html)) issues.push("La largeur HTML ne correspond pas à la largeur imprimable A4 calculée.");
  if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|height\s*:\s*0|left\s*:\s*-\d+/i.test(html)) {
    issues.push("Le HTML contient une règle susceptible de masquer le contenu.");
  }

  return issues;
}

const school = {
  name: "Acadéa Test School",
  address: "12 Avenue de l'École",
  phone: "+243 000 000",
  email: "contact@acadea.test",
};
const year = { name: "2026-2027" };
const student = { matricule: "MAT-001", nom: "Kabeya", postnom: "Mutombo", prenom: "Aline", sexe: "F", className: "1ère Primaire", phone: "+243 111 111" };
const payment = { id: "pay-1", receiptNumber: "REC-001", paidAt: "2026-10-10", amount: 120, cashierName: "Caissier Test" };
const expense = { spentAt: "2026-10-11", amount: 35, description: "Cahiers" };
const manyPayments = Array.from({ length: 80 }, (_, index) => ({
  ...payment,
  id: `pay-${index + 1}`,
  receiptNumber: `REC-${String(index + 1).padStart(3, "0")}`,
  amount: 20 + index,
}));

const money = (value) => `$${value.toFixed(2)}`;

const cases = [
  {
    name: "reçu de paiement",
    html: buildPdfHtml({
      title: "Reçu de paiement",
      school,
      subtitle: "Devise : Dollar américain (USD)",
      sections: [
        pdfInfoGrid([
          { label: "Reçu", value: payment.receiptNumber },
          { label: "Date", value: payment.paidAt },
          { label: "Élève", value: `${student.nom} ${student.postnom} ${student.prenom}` },
          { label: "Matricule", value: student.matricule },
          { label: "Classe", value: student.className },
          { label: "Type de frais", value: "Minerval" },
          { label: "Montant payé", value: money(payment.amount) },
          { label: "Caissier", value: payment.cashierName },
        ]),
      ],
    }),
    requiredText: [school.name, "Reçu de paiement", "REC-001", "Kabeya", "MAT-001", "$120.00"],
  },
  {
    name: "dashboard",
    html: buildPdfHtml({
      title: "Dashboard",
      school,
      year,
      sections: [
        pdfSection("KPI financier", pdfInfoGrid([{ label: "Recouvrement", value: "50%" }, { label: "Encaissé", value: money(120) }])),
        pdfSection("Transactions du jour", pdfTable([{ header: "Date", render: () => payment.paidAt }, { header: "Caissier", render: () => payment.cashierName }], [payment], "Aucune transaction.")),
      ],
    }),
    requiredText: [school.name, "Dashboard", "KPI financier", "Caissier Test"],
    requireTable: true,
  },
  {
    name: "liste des élèves",
    html: buildPdfHtml({
      title: "Liste des élèves",
      school,
      year,
      sections: [pdfSection("Élèves", pdfTable([{ header: "Matricule", render: (item) => item.matricule }, { header: "Nom complet", render: (item) => `${item.nom} ${item.postnom} ${item.prenom}` }], [student], "Aucun élève."))],
    }),
    requiredText: [school.name, "Liste des élèves", "MAT-001", "Kabeya Mutombo Aline"],
    requireTable: true,
  },
  {
    name: "historique individuel des paiements",
    html: buildPdfHtml({
      title: "Historique individuel des paiements",
      school,
      year,
      sections: [
        pdfSection("Identité de l'élève", pdfInfoGrid([{ label: "Nom complet", value: "Kabeya Mutombo Aline" }, { label: "Matricule", value: student.matricule }])),
        pdfSection("Paiements", pdfTable([{ header: "Date", render: () => payment.paidAt }, { header: "Type de frais", render: () => "Minerval" }, { header: "Montant payé", render: () => money(payment.amount) }], [payment], "Aucun paiement.")),
      ],
    }),
    requiredText: ["Historique individuel des paiements", "Kabeya Mutombo Aline", "Minerval", "$120.00"],
    requireTable: true,
  },
  {
    name: "rapport financier",
    html: buildPdfHtml({
      title: "Rapport Acadéa",
      school,
      year,
      sections: [
        pdfSection("Synthèse", pdfInfoGrid([{ label: "Paiements", value: money(payment.amount) }, { label: "Dépenses", value: money(expense.amount) }])),
        pdfSection("Paiements", pdfTable([{ header: "Date", render: () => payment.paidAt }, { header: "Montant", render: () => money(payment.amount) }], [payment], "Aucun paiement.")),
        pdfSection("Dépenses", pdfTable([{ header: "Date", render: () => expense.spentAt }, { header: "Description", render: () => expense.description }], [expense], "Aucune dépense.")),
      ],
    }),
    requiredText: ["Rapport Acadéa", "Synthèse", "$120.00", "$35.00", "Cahiers"],
    requireTable: true,
  },
  {
    name: "rapport financier avec beaucoup de lignes",
    html: buildPdfHtml({
      title: "Rapport Acadéa",
      school,
      year,
      sections: [
        pdfSection("Synthèse", pdfInfoGrid([{ label: "Paiements", value: money(4760) }, { label: "Dépenses", value: money(expense.amount) }])),
        pdfSection(
          "Paiements",
          pdfTable(
            [
              { header: "Date", render: (item) => item.paidAt },
              { header: "Caissier", render: (item) => item.cashierName },
              { header: "Montant", render: (item) => money(item.amount) },
              { header: "Reçu", render: (item) => item.receiptNumber },
            ],
            manyPayments,
            "Aucun paiement.",
          ),
        ),
      ],
    }),
    requiredText: ["Rapport Acadéa", "REC-001", "REC-080", "$99.00"],
    requireTable: true,
  },
];

for (const pdfCase of cases) {
  const issues = listTemplateIssues(pdfCase.html, { requireTable: pdfCase.requireTable });
  const missing = pdfCase.requiredText.filter((text) => !pdfCase.html.includes(text));

  if (issues.length || missing.length) {
    throw new Error(`${pdfCase.name}: ${[...issues, ...missing.map((text) => `Texte manquant: ${text}`)].join(" | ")}`);
  }
}

console.log(`PDF templates OK (${cases.length})`);
