/** Vite module loads only; never treats a business API request as a static file. */
export function isEmulatorSharedModuleRequest(method: string, resourceType: string, pathname: string) {
  return method === "GET" && resourceType === "script" && pathname.startsWith("/api/_lib/");
}
