import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { validateFirebaseEnvironment } from "./src/config/environment";

const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.VERCEL_DEPLOYMENT_ID?.trim() || String(Date.now());
const ocrAssets = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm", "tesseract-core-lstm.wasm"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm", "tesseract-core-relaxedsimd-lstm.wasm"],
  ["@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz", "fra.traineddata.gz"],
] as const;

function ocrMiddleware(request: { url?: string }, response: { setHeader: (key: string, value: string) => void; end: (data: Buffer) => void }, next: () => void) {
  const asset = ocrAssets.find(([, name]) => request.url?.split("?")[0] === `/ocr/${name}`);
  if (!asset) return next();
  const extension = asset[1].endsWith(".wasm") ? "application/wasm" : asset[1].endsWith(".gz") ? "application/gzip" : "text/javascript";
  response.setHeader("Content-Type", extension);
  response.end(readFileSync(resolve(process.cwd(), "node_modules", asset[0])));
}

export default defineConfig(({ mode }) => {
  const canonicalMode = mode === "production" ? "production" : mode === "staging" ? "staging" : "development";
  const canonicalPath = resolve(process.cwd(), `.env.${canonicalMode}`);
  const canonical = existsSync(canonicalPath) ? parse(readFileSync(canonicalPath)) : {};
  const loaded = loadEnv(mode, process.cwd(), "");
  const environment = { ...loaded, ...canonical, ...process.env };
  const localEmulator = mode === "test" && process.env.VITE_LOCAL_EMULATORS === "true";
  if (mode === "test") Object.assign(environment, {
    VITE_APP_ENV: "staging",
    VITE_FIREBASE_API_KEY: "test-public-api-key",
    VITE_FIREBASE_AUTH_DOMAIN: `${localEmulator ? "demo-acadea" : "acadea-staging"}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: localEmulator ? "demo-acadea" : "acadea-staging",
    VITE_FIREBASE_STORAGE_BUCKET: `${localEmulator ? "demo-acadea" : "acadea-staging"}.firebasestorage.app`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
    VITE_FIREBASE_APP_ID: "1:123:web:test",
  });
  const firebaseValues = {
    appEnv: environment.VITE_APP_ENV,
    localEmulator,
    apiKey: environment.VITE_FIREBASE_API_KEY,
    authDomain: environment.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: environment.VITE_FIREBASE_PROJECT_ID,
    storageBucket: environment.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: environment.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: environment.VITE_FIREBASE_APP_ID,
  };

  validateFirebaseEnvironment(firebaseValues);

  const viteDefines = Object.fromEntries(Object.entries(environment)
    .filter(([key]) => key.startsWith("VITE_"))
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));

  return {
  plugins: [
    react(),
    {
      name: "acadea-local-calendar-ocr-assets",
      configureServer(server) { server.middlewares.use(ocrMiddleware); },
      configurePreviewServer(server) { server.middlewares.use(ocrMiddleware); },
      generateBundle() {
        for (const [source, name] of ocrAssets) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: readFileSync(resolve(process.cwd(), "node_modules", source)) });
      },
    },
    {
      name: "acadea-build-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify(
            {
              version: buildId,
              generatedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        });
      },
    },
  ],
  define: {
    ...viteDefines,
    __ACADEA_BUILD_ID__: JSON.stringify(buildId),
  },
  optimizeDeps: {
    exclude: ["jspdf"],
  },
  };
});
