import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { validateFirebaseEnvironment } from "./src/config/environment";

const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? String(Date.now());

export default defineConfig(({ mode }) => {
  const canonicalMode = mode === "production" ? "production" : mode === "staging" ? "staging" : "development";
  const canonicalPath = resolve(process.cwd(), `.env.${canonicalMode}`);
  const canonical = existsSync(canonicalPath) ? parse(readFileSync(canonicalPath)) : {};
  const loaded = loadEnv(mode, process.cwd(), "");
  const environment = { ...loaded, ...canonical, ...process.env };
  if (mode === "test") Object.assign(environment, {
    VITE_APP_ENV: "staging",
    VITE_FIREBASE_API_KEY: "test-public-api-key",
    VITE_FIREBASE_AUTH_DOMAIN: "acadea-staging.firebaseapp.com",
    VITE_FIREBASE_PROJECT_ID: "acadea-staging",
    VITE_FIREBASE_STORAGE_BUCKET: "acadea-staging.firebasestorage.app",
    VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
    VITE_FIREBASE_APP_ID: "1:123:web:test",
  });
  const firebaseValues = {
    appEnv: environment.VITE_APP_ENV,
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
