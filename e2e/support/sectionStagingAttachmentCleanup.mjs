/** The server removes the temporary upload after committing its permanent copy. */
export async function removeDraftAfterSend(remove, reference, uploaded, committedMessage) {
  if (!uploaded) return;
  try {
    await remove(reference);
  } catch (error) {
    if (committedMessage?.attachments?.length && error?.code === 'storage/object-not-found') return;
    throw error;
  }
}
