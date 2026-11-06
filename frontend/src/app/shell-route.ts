import type { ComponentType } from "react";

import { createRootRoute } from "@tanstack/react-router";

import { NotFound } from "@/app/NotFound";
import { Shell } from "@/app/Shell";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The dictionary key of the screen's title, shown in the top bar and the tab. */
    titleKey?: string;
    /** What the screen offers in the top bar, after the palette. */
    HeaderAction?: ComponentType;
  }
}

/** The parent of every screen route. */
export const shellRoute = createRootRoute({ component: Shell, notFoundComponent: NotFound });
