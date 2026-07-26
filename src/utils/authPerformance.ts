function isEnabled() {
  if (typeof window === "undefined" || typeof performance === "undefined") return false;
  return import.meta.env.DEV;
}

export function markAuthStep(name: string) {
  if (!isEnabled()) return;
  performance.mark(name);
}

export function measureAuthStep(name: string, startMark: string, endMark: string) {
  if (!isEnabled()) return;
  try {
    const measurement = performance.measure(name, startMark, endMark);
    console.debug(`[Acadéa performance] ${name}: ${measurement.duration.toFixed(1)} ms`);
  } catch {
    // Une session restaurée peut ne pas posséder le marqueur de soumission du formulaire.
  }
}
