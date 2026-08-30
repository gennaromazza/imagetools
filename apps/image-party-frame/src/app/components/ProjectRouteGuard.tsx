import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { getImageFile, useProject } from "../contexts/ProjectContext";
import { loadExportSession } from "../hooks/useApi";
import { validateProjectForWorkspace } from "../lib/projectValidation";

export function ProjectRouteGuard({ children }: { children: ReactNode }) {
  const { project } = useProject();
  const location = useLocation();
  const validation = validateProjectForWorkspace(
    project,
    (imageId) => Boolean(getImageFile(imageId, project.projectId))
  );
  const resumableExport = location.pathname === "/export-progress"
    && Boolean(loadExportSession()?.jobId);

  if (!validation.canContinue && !resumableExport) {
    return (
      <Navigate
        to="/new-project"
        replace
        state={{
          blockedRoute: location.pathname,
          validationErrors: validation.errorCount,
        }}
      />
    );
  }

  return children;
}
