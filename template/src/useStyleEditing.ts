import { useCallback } from 'react';
import type { EdgeLayoutEdit, NodeStyleEdit } from './buildGraph';
import {
  EMPTY_NODE_STYLES,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  clampNumber,
  isValidColor,
  type PersistState,
} from './persistState';

type SetPersist = (mutate: (current: PersistState) => PersistState) => void;

/** What the style bar can set. `undefined` on a field clears that override. */
export interface StylePatch {
  textScale?: number;
  ink?: string;
  border?: string;
}

export interface StyleEditingApi {
  nodeStyles: Record<string, NodeStyleEdit>;
  /** Applies one patch to every named node; `null` on a field clears it. */
  applyNodeStyle(nodeIds: readonly string[], patch: Record<string, string | number | null>): void;
  applyEdgeStyle(edgeIds: readonly string[], patch: Record<string, string | number | null>): void;
  clearStyles(nodeIds: readonly string[], edgeIds: readonly string[]): void;
}

function isEmptyEdit(edit: NodeStyleEdit): boolean {
  return edit.textScale === undefined && !edit.ink && !edit.border;
}

function isEmptyEdgeEdit(edit: EdgeLayoutEdit): boolean {
  return (!edit.waypoints || edit.waypoints.length === 0)
    && edit.labelFraction === undefined
    && edit.labelScale === undefined
    && !edit.color;
}

/**
 * Validate on the WAY IN, not only on read-back. The same regex guards the
 * load path (persistState.normalisePersistState), because this blob is
 * serialised into the downloadable offline HTML and re-applied as an inline
 * style: a colour that never enters the state cannot leave it either.
 */
function sanitise(field: string, value: string | number | null): string | number | null | undefined {
  if (value === null) return null;
  if (field === 'textScale' || field === 'labelScale') {
    return typeof value === 'number' && Number.isFinite(value)
      ? clampNumber(value, TEXT_SCALE_MIN, TEXT_SCALE_MAX)
      : undefined;
  }
  return isValidColor(value) ? (value as string).trim() : undefined;
}

function patchRecord<T extends object>(
  current: T | undefined,
  patch: Record<string, string | number | null>,
): T {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  Object.entries(patch).forEach(([field, value]) => {
    const clean = sanitise(field, value);
    if (clean === undefined) return; // Rejected value: leave the field alone.
    if (clean === null) delete next[field];
    else next[field] = clean;
  });
  return next as T;
}

/**
 * Node and edge style overrides for one diagram, and the apply-to-selection
 * logic the style bar drives. Every write goes through the same validator as
 * the load path.
 */
export function useStyleEditing(
  diagramId: string,
  persist: PersistState,
  setPersist: SetPersist,
): StyleEditingApi {
  const nodeStyles = persist.styles?.[diagramId] ?? EMPTY_NODE_STYLES;

  const applyNodeStyle = useCallback((
    nodeIds: readonly string[],
    patch: Record<string, string | number | null>,
  ) => {
    if (nodeIds.length === 0) return;
    setPersist((current) => {
      const diagramStyles = { ...(current.styles?.[diagramId] ?? {}) };
      nodeIds.forEach((id) => {
        const next = patchRecord<NodeStyleEdit>(diagramStyles[id], patch);
        if (isEmptyEdit(next)) delete diagramStyles[id];
        else diagramStyles[id] = next;
      });
      const styles = { ...(current.styles ?? {}) };
      if (Object.keys(diagramStyles).length === 0) delete styles[diagramId];
      else styles[diagramId] = diagramStyles;
      return { ...current, styles };
    });
  }, [diagramId, setPersist]);

  const applyEdgeStyle = useCallback((
    edgeIds: readonly string[],
    patch: Record<string, string | number | null>,
  ) => {
    if (edgeIds.length === 0) return;
    setPersist((current) => {
      const diagramEdges = { ...(current.edges[diagramId] ?? {}) };
      edgeIds.forEach((id) => {
        const next = patchRecord<EdgeLayoutEdit>(diagramEdges[id], patch);
        if (isEmptyEdgeEdit(next)) delete diagramEdges[id];
        else diagramEdges[id] = next;
      });
      const edges = { ...current.edges };
      if (Object.keys(diagramEdges).length === 0) delete edges[diagramId];
      else edges[diagramId] = diagramEdges;
      return { ...current, edges };
    });
  }, [diagramId, setPersist]);

  const clearStyles = useCallback((nodeIds: readonly string[], edgeIds: readonly string[]) => {
    applyNodeStyle(nodeIds, { textScale: null, ink: null, border: null });
    // Geometry edits (waypoints, label position) are NOT styles and survive a
    // style reset — Reset Layout is the action that clears those.
    applyEdgeStyle(edgeIds, { color: null, labelScale: null });
  }, [applyEdgeStyle, applyNodeStyle]);

  return { nodeStyles, applyNodeStyle, applyEdgeStyle, clearStyles };
}
