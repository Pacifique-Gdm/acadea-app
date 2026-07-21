import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/app/AppErrorBoundary";
import PwaUpdatePrompt from "./PwaUpdatePrompt";
import { registerServiceWorker } from "./pwa";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      <PwaUpdatePrompt />
    </AppErrorBoundary>
  </StrictMode>,
);

registerServiceWorker();
