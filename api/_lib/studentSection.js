import { getClassSection } from "../../src/utils/studentYearTransition.js";

// Section obligatoire pour tout élève (décision de l'utilisateur du 27/11/2026).
// Section absente : calculée d'après la classe (comme l'écran). Section envoyée
// mais inconnue : refusée. Même compatibilité que getStudentSection (écran) :
// une classe CTEB est toujours en section CTEB.
const SECTIONS = { maternelle: "Maternelle", primaire: "Primaire", cteb: "CTEB", cetb: "CTEB", secondaire: "Secondaire" };

export class InvalidStudentSection extends Error {
  constructor() { super("Section de l’élève invalide."); this.statusCode = 400; this.code = "invalid-argument"; }
}

export function requiredStudentSection(student) {
  const classSection = getClassSection(String(student?.className ?? ""));
  const raw = student?.section;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return classSection;
  const section = typeof raw === "string" ? SECTIONS[raw.trim().toLocaleLowerCase()] : undefined;
  if (!section) throw new InvalidStudentSection();
  return classSection === "CTEB" ? "CTEB" : section;
}
