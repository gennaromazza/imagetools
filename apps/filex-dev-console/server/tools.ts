import { desktopToolManifest, getSuiteManagedTools } from "../../filex-desktop/src/tool-manifest.js";

export interface DevTool {
  id: string;
  displayName: string;
  workspace: "@photo-tools/filex-desktop";
  devScript: string;
  buildScript: string;
  port: number;
  kind: "electron";
  rendererUrl: string;
}

function readDevPort(toolId: string, devUrl: string | undefined): { port: number; rendererUrl: string } {
  if (!devUrl) {
    throw new Error(`Il tool desktop "${toolId}" non ha un devUrl nel manifest.`);
  }

  const url = new URL(devUrl);
  if (url.protocol !== "http:" || !url.port) {
    throw new Error(`Il devUrl del tool "${toolId}" non è un URL HTTP con porta valida.`);
  }

  return { port: Number(url.port), rendererUrl: url.toString().replace(/\/$/, "") };
}

/**
 * Fonte unica per la dashboard: il catalogo dei tool desktop.
 * Ogni tool viene avviato tramite lo script Electron canonico `dev:<tool-id>`.
 */
export const DEV_TOOLS: DevTool[] = getSuiteManagedTools().map((tool) => {
  const { port, rendererUrl } = readDevPort(tool.id, tool.devUrl);
  return {
    id: tool.id,
    displayName: tool.displayName,
    workspace: "@photo-tools/filex-desktop",
    devScript: `dev:${tool.id}`,
    // Image Select Pro è l'unico tool il cui script di build storico non
    // coincide con l'id del manifest. La dashboard deve usare il nome
    // effettivamente dichiarato nel package del desktop.
    buildScript: tool.id === "photo-selector-app" ? "build:photo-selector" : `build:${tool.id}`,
    port,
    kind: "electron",
    rendererUrl,
  };
});

const suite = desktopToolManifest["suite-launcher"];

export const SUITE_TOOL = {
  id: suite.id,
  displayName: suite.displayName,
  workspace: "@photo-tools/filex-desktop",
  startScript: "start:suite",
} as const;
