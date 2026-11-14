import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PersistenceNotice } from "./components/layout/PersistenceNotice";
import PwaUpdatePrompt from "./PwaUpdatePrompt";
import { registerServiceWorker } from "./pwa";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <>
      {/* Lot 12 : un écran chargé à la demande affiche ce message le temps de son premier chargement. */}
      <Suspense fallback={<p role="status" className="p-6 text-center text-sm text-slate-500">Chargement…</p>}>
        <App />
      </Suspense>
      <PersistenceNotice />
      <PwaUpdatePrompt />
    </>
  </StrictMode>,
);

registerServiceWorker();
