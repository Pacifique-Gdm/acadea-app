import { expect, type BrowserContext, type Page } from "@playwright/test";
import { guard } from "./emulatorRecipe";

// Controlled latency/failure adapters for real UI components, NOT a hosted Firebase recipe.
export async function feedbackTransport(context: BrowserContext, overrides: Record<string, string>) {
  guard();
  await context.addInitScript(() => {
    const calls: Record<string, number> = {};
    const pending: Record<string, Array<{ resolve: (value?: unknown) => void; reject: (error: Error) => void }>> = {};
    Object.assign(window, { feedback: { calls, pending, call(key: string) {
      calls[key] = (calls[key] ?? 0) + 1;
      return new Promise((resolve, reject) => { (pending[key] ??= []).push({ resolve, reject }); });
    } } });
  });
  for (const [path, exports] of Object.entries(overrides)) {
    await context.route(`**${path}*`, async (route) => {
      if (new URL(route.request().url()).searchParams.has("feedbackActual")) return route.continue();
      await route.fulfill({ contentType: "application/javascript", body: `export * from ${JSON.stringify(path + "?feedbackActual")};\n${exports}` });
    });
  }
}

export async function settle(page: Page, key: string, value?: unknown, error?: string) {
  await expect.poll(() => page.evaluate((key) => ((window as unknown as { feedback: { pending: Record<string, unknown[]> } }).feedback.pending[key] ?? []).length, key)).toBeGreaterThan(0);
  await page.evaluate(({ key, value, error }) => {
    const state = (window as unknown as { feedback: { pending: Record<string, Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }>> } }).feedback;
    const pending = state.pending[key].splice(0);
    pending.forEach((item) => error ? item.reject(new Error(error)) : item.resolve(value));
  }, { key, value, error });
}
export async function calls(page: Page, key: string) {
  return page.evaluate((key) => (window as unknown as { feedback: { calls: Record<string, number> } }).feedback.calls[key] ?? 0, key);
}
export async function mount(page: Page, path: string, name: string, props: Record<string, unknown>) {
  await page.goto("/login");
  await page.evaluate(async ({ path, name, props }) => {
    const reactPath = "/node_modules/.vite/deps/react.js", domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const r = await import(reactPath), d = await import(domPath), module = await import(path);
    const React = r.default ?? r, { createRoot } = d.default ?? d;
    const container = document.createElement("div"); container.id = "feedback-harness"; document.body.appendChild(container);
    const noop = () => {};
    createRoot(container).render(React.createElement(module[name], { onClose: noop, onSchoolChange: noop, ...props }));
  }, { path, name, props });
  return page.locator("#feedback-harness");
}
