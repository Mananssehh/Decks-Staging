import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { installGlobalErrorHandlers } from "./lib/errorLogger";
import { initMonitoring } from "./lib/monitoring";

initMonitoring();
installGlobalErrorHandlers();

const root = document.getElementById("root");
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
