import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  test.setTimeout(120000);
  const result = await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MoneyInput}from'./src/components/ui/MoneyInput';function App(){const[v,set]=useState('');return <><MoneyInput value={v} onChange={set} ariaLabel="Montant"/><output>{v}</output></>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" }, jsx: "automatic", bundle: true, write: false });
  server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html"); res.end(req.url === "/app.js" ? result.outputFiles[0].text : '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>'); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Serveur local absent");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });
test("frappes, milliers, décimales, suppression et curseur", async ({ page }) => {
  await page.goto(origin);
  const input = page.getByLabel("Montant");
  await input.pressSequentially("100000");
  await expect(input).toHaveValue("100 000");
  await expect(page.locator("output")).toHaveText("100000");
  await input.press("Backspace");
  await expect(input).toHaveValue("10 000");
  await input.pressSequentially(",50");
  await expect(input).toHaveValue("10 000,50");
  await expect(page.locator("output")).toHaveText("10000.50");
  await input.fill("1 250,25");
  await expect(page.locator("output")).toHaveText("1250.25");
  await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(3, 3));
  await input.press("9");
  await expect(input).toHaveValue("12 950,25");
  expect(await input.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(4);
});
