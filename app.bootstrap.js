import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app.compiled.v2.js?v=visualpolish-20260606";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(React.createElement(App));
}
