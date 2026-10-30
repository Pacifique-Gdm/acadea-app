import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PersistenceNotice } from "./components/layout/PersistenceNotice";
import PwaUpdatePrompt from "./PwaUpdatePrompt";
import { registerServiceWorker } from "./pwa";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <>
      <App />
      <PersistenceNotice />
      <PwaUpdatePrompt />
    </>
  </StrictMode>,
);

registerServiceWorker();
