import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_ENV": JSON.stringify("staging"),
    "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify("test-public-api-key"),
    "import.meta.env.VITE_FIREBASE_AUTH_DOMAIN": JSON.stringify("acadea-staging.firebaseapp.com"),
    "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify("acadea-staging"),
    "import.meta.env.VITE_FIREBASE_STORAGE_BUCKET": JSON.stringify("acadea-staging.firebasestorage.app"),
    "import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID": JSON.stringify("123"),
    "import.meta.env.VITE_FIREBASE_APP_ID": JSON.stringify("1:123:web:test"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
