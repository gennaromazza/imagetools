export interface SuiteStartupPolicyInput {
  startsInBackground: boolean;
  dockEnabled: boolean;
}

export function resolveSuiteLauncherBounds(
  area: { x: number; y: number; width: number; height: number },
  requestedWidth: number, requestedHeight: number, anchorX: number,
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(requestedWidth, area.width);
  const height = Math.min(requestedHeight, area.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, anchorX - width / 2))),
    y: area.y + Math.max(0, area.height - height - 8),
    width, height,
  };
}

export interface SuiteStartupPolicy {
  createMainWindow: boolean;
  createDock: boolean;
}

export interface PersistedSuiteDockPreference {
  enabled?: unknown;
}

export function resolveSuiteDockEnabled(
  state: PersistedSuiteDockPreference | null | undefined,
): boolean {
  return state?.enabled !== false;
}

export function resolveSuiteStartupPolicy(input: SuiteStartupPolicyInput): SuiteStartupPolicy {
  return {
    createMainWindow: !input.startsInBackground && !input.dockEnabled,
    createDock: input.dockEnabled,
  };
}
