import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/newsreader";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/app";
import { createBrowserAppRouter } from "./app/router";
import "./styles/index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Web application root element is missing.");
}

const router = createBrowserAppRouter();

createRoot(root).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
);
