import jsPDF from "jspdf";
import type { FeeType, Payment, School, Student } from "../types";

export async function generateReceiptPdf(payment: Payment, student: Student, feeType: FeeType, school: School) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 48;

  doc.setFillColor(20, 33, 61);
  doc.rect(0, 0, pageWidth, 112, "F");

  const logoDataUrl = await loadLogoDataUrl(school.logoUrl);
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, "PNG", left, 28, 44, 44);
  } else {
    doc.setFillColor(42, 157, 143);
    doc.circle(left + 22, 50, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("A", left + 17, 56);
  }

  doc.setFontSize(22);
  doc.text(school.name, left + 60, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${school.address} | ${school.phone} | ${school.email}`, left + 60, 66);
  doc.text(`Devise: Dollar américain (${school.currency})`, left + 60, 84);

  doc.setTextColor(20, 33, 61);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Reçu de paiement", left, 160);

  doc.setDrawColor(220, 226, 235);
  doc.roundedRect(left, 185, pageWidth - left * 2, 250, 8, 8);

  const rows = [
    ["Reçu", payment.id.toUpperCase()],
    ["Date", new Date(payment.paidAt).toLocaleDateString("fr-FR")],
    ["Élève", `${student.nom} ${student.postnom} ${student.prenom}`],
    ["Matricule", student.matricule],
    ["Classe", student.className],
    ["Type de frais", feeType.name],
    ["Montant payé", `$${payment.amount.toFixed(2)}`],
    ["Caissier", payment.cashierName],
  ];

  doc.setFontSize(11);
  rows.forEach(([label, value], index) => {
    const y = 218 + index * 26;
    doc.setFont("helvetica", "bold");
    doc.text(label, left + 24, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, left + 170, y);
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Signature et cachet", pageWidth - 190, 500);
  doc.setDrawColor(20, 33, 61);
  doc.line(pageWidth - 220, 545, pageWidth - 70, 545);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("Document généré par Acadéa.", left, 760);

  doc.save(`recu-${student.matricule}-${payment.id}.pdf`);
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
