import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./style.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Only in a built app: in development Vite serves changing files, which a cache would hide.
if (import.meta.env.PROD && "serviceWorker" in navigator)
  addEventListener("load", () => void navigator.serviceWorker.register("./sw.js"));
