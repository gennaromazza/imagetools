import { createBrowserRouter, createHashRouter } from "react-router";
import { Suspense, createElement, lazy, type ComponentType, type ReactNode } from "react";
import { ProjectRouteGuard } from "./components/ProjectRouteGuard";

const Home = lazy(() => import("./pages/Home"));
const NewProject = lazy(() => import("./pages/NewProject"));
const TemplateValidation = lazy(() => import("./pages/TemplateValidation"));
const Workspace = lazy(() => import("./pages/Workspace"));
const ImageComparison = lazy(() => import("./pages/ImageComparison"));
const ExportSettings = lazy(() => import("./pages/ExportSettings"));
const ExportProgress = lazy(() => import("./pages/ExportProgress"));
const CustomTemplateBuilder = lazy(() => import("./pages/CustomTemplateBuilder"));

function RouteLoading() {
  return createElement(
    "main",
    {
      className: "min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex items-center justify-center",
    },
    createElement(
      "div",
      { role: "status", className: "rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-4 text-sm text-[var(--app-text-muted)]" },
      "Caricamento della schermata…"
    )
  );
}

const page = (Component: ComponentType) => createElement(
  Suspense,
  { fallback: createElement(RouteLoading) },
  createElement(Component)
);
const guarded = (element: ReactNode) => createElement(ProjectRouteGuard, null, element);

const routeConfig = [
  {
    path: "/",
    element: page(Home),
  },
  {
    path: "/new-project",
    element: page(NewProject),
  },
  {
    path: "/template-validation",
    element: page(TemplateValidation),
  },
  {
    path: "/workspace",
    element: guarded(page(Workspace)),
  },
  {
    path: "/image-comparison",
    element: guarded(page(ImageComparison)),
  },
  {
    path: "/export-settings",
    element: guarded(page(ExportSettings)),
  },
  {
    path: "/export-progress",
    element: guarded(page(ExportProgress)),
  },
  {
    path: "/custom-template",
    element: page(CustomTemplateBuilder),
  },
];

const isFileProtocol = typeof window !== "undefined" && window.location.protocol === "file:";

export const router = isFileProtocol
  ? createHashRouter(routeConfig)
  : createBrowserRouter(routeConfig);
