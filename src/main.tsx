import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App";
import { StageWindow } from "./components/stage/StageWindow";
import { hydrateShowFromDisk } from "./lib/showFile";
import { isStageWindow } from "./lib/stageMirror";

// La segunda ventana no abre el show: solo mira el de la principal.
const stageWindow = isStageWindow();

void (stageWindow ? Promise.resolve() : hydrateShowFromDisk()).then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{stageWindow ? <StageWindow /> : <App />}</React.StrictMode>,
  );
});
