export function classFilterReadyForPage(classKey: string, optionKey: string, choicesReady: boolean, classValid: boolean, optionValid: boolean) {
  if (!classKey && !optionKey) return true;
  return choicesReady && (!classKey || classValid) && (!optionKey || optionValid);
}
