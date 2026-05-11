import React from "react";
import { createRoot } from "react-dom/client";
import App from "https://esm.sh/gh/lllkayan11/etf-correlation-pages/etf-correlation-dashboard.jsx";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(React.createElement(App));
}
