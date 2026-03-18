import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ProjectProvider } from "./contexts/ProjectContext";
import { Toaster } from "sonner";

export default function App() {
  return (
    <ProjectProvider>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: "var(--app-surface)",
            color: "var(--app-text)",
            border: "1px solid var(--app-border)",
            boxShadow: "0 18px 42px rgba(0,0,0,0.18)",
          },
        }}
      />
    </ProjectProvider>
  );
}
