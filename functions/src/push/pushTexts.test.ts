import { describe, expect, it } from "vitest";
import { messagePushText, pushText, studentDisplayName } from "./pushTexts.js";

describe("lot 25 : textes des notifications push", () => {
  const context = { schoolName: "C.S Fictif", firstName: "Grâce", sex: "F" };
  it("paiement, correction, annulation et notes : école et prénom, jamais de montant", () => {
    expect(pushText("payment_recorded", context)).toEqual({ title: "C.S Fictif — Paiement reçu", body: "Un paiement a été enregistré pour Grâce. Touchez pour voir le reçu." });
    expect(pushText("payment_corrected", context)).toEqual({ title: "C.S Fictif — Paiement corrigé", body: "Un paiement de Grâce a été corrigé. Touchez pour voir le détail." });
    expect(pushText("payment_cancelled", context)).toEqual({ title: "C.S Fictif — Paiement annulé", body: "Un paiement de Grâce a été annulé. Touchez pour voir le détail." });
    expect(pushText("grades_published", context)).toEqual({ title: "C.S Fictif — Nouvelles notes", body: "Les notes de Grâce ont été publiées." });
  });
  it("absence et retard s'accordent avec le sexe de l'élève (forme « (e) » s'il est inconnu)", () => {
    expect(pushText("student_absent", { ...context, firstName: "Jean", sex: "M" }).body).toBe("Jean a été noté absent aujourd'hui.");
    expect(pushText("student_late", { schoolName: "C.S Fictif", firstName: "Alex" }).body).toBe("Alex est arrivé(e) en retard aujourd'hui.");
  });
  it("sanction : jamais le motif ; annonce : son titre", () => {
    expect(pushText("discipline_incident_created", context)).toEqual({ title: "C.S Fictif — Information discipline", body: "Une information concernant Grâce est disponible." });
    expect(pushText("announcement_published", context, { title: "Rentrée du lundi" })).toEqual({ title: "C.S Fictif — Nouvelle annonce", body: "Rentrée du lundi" });
  });
  it("message : expéditeur et objet ; « Équipe ACADÉA » pour le Super administrateur", () => {
    expect(messagePushText({ senderName: "Marie Kabila", senderRole: "secretary", subject: "Réunion" })).toEqual({ title: "Nouveau message — Marie Kabila", body: "Objet : Réunion" });
    expect(messagePushText({ senderName: "Pacifique", senderRole: "super_admin", subject: "Mise à jour" }).title).toBe("Nouveau message — Équipe ACADÉA");
  });
  it("valeurs manquantes : textes génériques propres", () => {
    expect(pushText("payment_recorded", {})).toEqual({ title: "Acadéa — Paiement reçu", body: "Un paiement a été enregistré pour votre enfant. Touchez pour voir le reçu." });
    expect(pushText("student_absent", {}).body).toBe("Votre enfant a été noté(e) absent(e) aujourd'hui.");
  });
  it("prénom s'il existe, sinon nom et post-nom ; jamais de vide ni « undefined »", () => {
    expect(studentDisplayName({ nom: "KABILA", postnom: "MUJINGA", prenom: "Grâce" })).toBe("Grâce");
    expect(studentDisplayName({ nom: "KABILA", postnom: "MUJINGA", prenom: "  " })).toBe("KABILA MUJINGA");
    expect(studentDisplayName({ nom: "KABILA", postnom: "undefined", prenom: "undefined" })).toBe("KABILA");
    expect(studentDisplayName({})).toBe("");
    const text = JSON.stringify(pushText("payment_recorded", { schoolName: "undefined", firstName: studentDisplayName({ prenom: null }) }));
    expect(text).not.toMatch(/undefined|null|pour \./);
    expect(pushText("announcement_published", { schoolName: "C.S Fictif" }, { title: "undefined" }).body).toBe("Une nouvelle annonce est disponible.");
  });
});
