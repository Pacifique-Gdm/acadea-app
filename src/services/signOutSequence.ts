/** P4, lot 1 : délai maximum laissé au retrait du jeton de notifications avant la vraie déconnexion. */
export const PUSH_TOKEN_FORGET_DEADLINE_MS = 3_000;

/**
 * Retire le jeton de notifications puis déconnecte TOUJOURS.
 * Sans réseau, la suppression Firestore du jeton reste « en attente » et ne se termine jamais
 * (vérifié sur l'émulateur) : on ne l'attend donc que `deadlineMs`, puis on appelle `signOut` quoi qu'il arrive.
 * Retourne `true` si le jeton a été retiré à temps, `false` sinon.
 */
export async function forgetTokenThenSignOut({ forget, signOut, deadlineMs = PUSH_TOKEN_FORGET_DEADLINE_MS }: {
  forget?: () => Promise<unknown>;
  signOut: () => Promise<unknown>;
  deadlineMs?: number;
}): Promise<boolean> {
  let forgotten = false;
  if (forget) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlineMs); });
    const attempt = Promise.resolve().then(forget).then(() => { forgotten = true; }, () => undefined);
    await Promise.race([attempt, deadline]);
    if (timer !== undefined) clearTimeout(timer);
  }
  await signOut();
  return forgotten;
}
