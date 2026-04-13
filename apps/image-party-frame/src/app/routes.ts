import { createBrowserRouter, createHashRouter } from "react-router";
import Home from "./pages/Home";
import NewProject from "./pages/NewProject";
import TemplateValidation from "./pages/TemplateValidation";
import Workspace from "./pages/Workspace";
import ImageComparison from "./pages/ImageComparison";
import ExportSettings from "./pages/ExportSettings";
import ExportProgress from "./pages/ExportProgress";
import CustomTemplateBuilder from "./pages/CustomTemplateBuilder";

const routeConfig = [
  {
    path: "/",
    Component: Home,
  },
  {
    path: "/new-project",
    Component: NewProject,
  },
  {
    path: "/template-validation",
    Component: TemplateValidation,
  },
  {
    path: "/workspace",
    Component: Workspace,
  },
  {
    path: "/image-comparison",
    Component: ImageComparison,
  },
  {
    path: "/export-settings",
    Component: ExportSettings,
  },
  {
    path: "/export-progress",
    Component: ExportProgress,
  },
  {
    path: "/custom-template",
    Component: CustomTemplateBuilder,
  },
];

const isFileProtocol = typeof window !== "undefined" && window.location.protocol === "file:";

export const router = isFileProtocol
  ? createHashRouter(routeConfig)
  : createBrowserRouter(routeConfig);
