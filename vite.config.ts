import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? String(Date.now());

export default defineConfig({
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
    "import.meta.env.VITE_APP_ENV": JSON.stringify(process.env.VITE_APP_ENV ?? process.env.VERCEL_ENV ?? "development"),
    __ACADEA_BUILD_ID__: JSON.stringify(buildId),
  },
  optimizeDeps: {
    exclude: ["jspdf"],
  },
});
