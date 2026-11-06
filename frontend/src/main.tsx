import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { createAppRouter } from "@/app/router";
import { followOldBookmark } from "@/lib/browser";
import { applyStoredTheme } from "@/lib/theme";
import { createQueryClient } from "@/lib/query";

import "@/index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html has no #root element");

applyStoredTheme();
followOldBookmark();

createRoot(rootElement).render(
  <StrictMode>
    <App router={createAppRouter()} queryClient={createQueryClient()} />
  </StrictMode>,
);
