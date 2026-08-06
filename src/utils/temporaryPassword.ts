export function temporaryPasswordAfterPhoneChange(params: {
  nextPhone: string;
  currentPassword: string;
  manuallyEdited: boolean;
}) {
  return params.manuallyEdited ? params.currentPassword : params.nextPhone;
}
