export function validateOtherSanctionDescriptions(reason: string, reasonDescription: string, sanctionType: string, sanctionDescription: string) {
  return {
    reasonError: reason === "Autre" && !reasonDescription.trim() ? "La description du motif est obligatoire lorsque le motif est « Autre »." : "",
    sanctionError: sanctionType === "Autre" && !sanctionDescription.trim() ? "La description de la sanction est obligatoire lorsque la sanction est « Autre »." : "",
  };
}
