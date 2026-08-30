export interface SuiteStartupPolicyInput {
  startsInBackground: boolean;
  dockEnabled: boolean;
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
    createMainWindow: !input.startsInBackground,
    createDock: input.dockEnabled,
  };
}
