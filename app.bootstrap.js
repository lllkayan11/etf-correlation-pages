import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app.compiled.v2.js";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(React.createElement(App));
}
