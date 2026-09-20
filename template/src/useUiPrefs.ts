import { useCallback, useMemo } from 'react';
import {
  DEFAULT_TOOL_PREFS,
  DEFAULT_UI_PREFS,
  SIDE_WIDTH_DEFAULT,
  SIDE_WIDTH_MAX,
  SIDE_WIDTH_MIN,
  clampNumber,
  type PersistState,
  type SidecarMode,
  type ToolPrefs,
  type UiPrefs,
} from './persistState';

type SetPersist = (mutate: (current: PersistState) => PersistState) => void;

export interface UiPrefsApi {
  ui: UiPrefs;
  /** True when a tool is switched on AND the master switch allows it. */
  toolVisible(tool: keyof ToolPrefs): boolean;
  setSidecar(mode: SidecarMode): void;
  /** Re-opens a hidden sidecar in its last-used docked mode. */
  openSidecar(): void;
  toggleSidecar(): void;
  setSideWidth(width: number): void;
  resetSideWidth(): void;
  setTool(tool: keyof ToolPrefs, on: boolean): void;
}

/**
 * Interface preferences: where the inspector sits, how wide it is, which
 * canvas tools are showing. Global rather than per diagram, and persisted in
 * the same blob as the layout edits so a downloaded offline copy opens the
 * way it was left.
 */
export function useUiPrefs(persist: PersistState, setPersist: SetPersist): UiPrefsApi {
  const ui = persist.ui ?? DEFAULT_UI_PREFS;

  const mutateUi = useCallback((mutate: (current: UiPrefs) => UiPrefs) => {
    setPersist((current) => ({
      ...current,
      ui: mutate(current.ui ?? DEFAULT_UI_PREFS),
    }));
  }, [setPersist]);

  // Choosing a docked mode also records it as the one to reopen into.
  const setSidecar = useCallback((mode: SidecarMode) => {
    mutateUi((current) => ({
      ...current,
      sidecar: mode,
      lastDocked: mode === 'hidden' ? current.lastDocked : mode,
    }));
  }, [mutateUi]);

  const openSidecar = useCallback(() => {
    mutateUi((current) => (
      current.sidecar === 'hidden'
        ? { ...current, sidecar: current.lastDocked ?? 'right' }
        : current
    ));
  }, [mutateUi]);

  const toggleSidecar = useCallback(() => {
    mutateUi((current) => ({
      ...current,
      sidecar: current.sidecar === 'hidden' ? (current.lastDocked ?? 'right') : 'hidden',
    }));
  }, [mutateUi]);

  const setSideWidth = useCallback((width: number) => {
    mutateUi((current) => ({
      ...current,
      sideWidth: Math.round(clampNumber(width, SIDE_WIDTH_MIN, SIDE_WIDTH_MAX)),
    }));
  }, [mutateUi]);

  const resetSideWidth = useCallback(() => {
    mutateUi((current) => ({ ...current, sideWidth: SIDE_WIDTH_DEFAULT }));
  }, [mutateUi]);

  const setTool = useCallback((tool: keyof ToolPrefs, on: boolean) => {
    mutateUi((current) => ({
      ...current,
      tools: { ...(current.tools ?? DEFAULT_TOOL_PREFS), [tool]: on },
    }));
  }, [mutateUi]);

  const toolVisible = useCallback((tool: keyof ToolPrefs) => {
    const tools = ui.tools ?? DEFAULT_TOOL_PREFS;
    return tools.master && (tool === 'master' || tools[tool]);
  }, [ui.tools]);

  // Memoised: the App's keyboard effect depends on this object, and a fresh
  // identity every render would tear down and re-attach the window listener
  // on each one.
  return useMemo(() => ({
    ui,
    toolVisible,
    setSidecar,
    openSidecar,
    toggleSidecar,
    setSideWidth,
    resetSideWidth,
    setTool,
  }), [
    openSidecar,
    resetSideWidth,
    setSidecar,
    setSideWidth,
    setTool,
    toggleSidecar,
    toolVisible,
    ui,
  ]);
}
