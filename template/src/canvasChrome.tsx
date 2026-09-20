import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useViewport } from '@xyflow/react';
import type { DiagramFlowNode } from './buildGraph';
import type { DiagramDef } from './model';
import { SIDE_WIDTH_MAX, SIDE_WIDTH_MIN } from './persistState';

/**
 * Minimap tint. Without it React Flow paints this colour-coded quilt as
 * uniform grey blocks and the overview loses the only signal it exists to
 * give — which domain you are looking at.
 */
const CSDM_DOMAIN_COLORS: Record<string, string> = {
  build: '#a02b93',
  design: '#0f9ed5',
  ideation: '#4ea72e',
  delivery: '#f19714',
  consumption: '#54c45e',
  foundation: '#e9e9e9',
  portfolio: '#ffffff',
};

const BLOCK_COLORS: Record<string, string> = {
  lime: '#dceeb1',
  lilac: '#c5b0f4',
  cream: '#f4ecd6',
  mint: '#c8e6cd',
  pink: '#efd4d4',
  coral: '#f3c9b6',
  navy: '#1f1d3d',
  soft: '#e9e9e9',
};

export function makeMinimapNodeColor(diagram: DiagramDef): (node: DiagramFlowNode) => string {
  const domainByGroup = new Map(diagram.groups.map((group) => [group.id, group.domain]));
  return (node) => {
    if (node.type === 'csdmRegion') {
      const domain = (node.data as { def?: { domain?: string } }).def?.domain;
      return (domain && CSDM_DOMAIN_COLORS[domain]) ?? '#d8d8d8';
    }
    if (node.type === 'csdmCard') {
      const groupId = (node.data as { def?: { group?: string } }).def?.group;
      const domain = groupId ? domainByGroup.get(groupId) : undefined;
      return (domain && CSDM_DOMAIN_COLORS[domain]) ?? '#ffffff';
    }
    const color = (node.data as { groupColor?: string }).groupColor;
    return (color && BLOCK_COLORS[color]) ?? '#d8d8d8';
  };
}

/** Live zoom percentage; a click fits the diagram back to the viewport. */
export function ZoomReadout({ onReset }: { onReset(): void }) {
  const { zoom } = useViewport();
  return (
    <button
      type="button"
      className="dg-zoom-readout"
      title="Fit the diagram to the view"
      onClick={onReset}
    >
      {Math.round(zoom * 100)}%
    </button>
  );
}

/**
 * Drag-to-resize strip on the inspector's inner edge. Arrow keys nudge it and
 * a double-click restores the default, because a 4px drag target is the one
 * control here that is genuinely hard to hit.
 */
export function SideResizer({
  width,
  onWidth,
  onReset,
}: {
  width: number;
  onWidth(next: number): void;
  onReset(): void;
}) {
  // Every resize session is tracked so it can be torn down if the strip
  // unmounts mid-drag — hiding the inspector with `I` while holding the
  // pointer otherwise left a live listener writing to a width nobody could
  // see (cross-vendor review, 2026-09-15). Blur and visibility loss end it
  // for the same reason the edge-drag session guards those.
  const sessionRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => sessionRef.current?.(), []);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    sessionRef.current?.();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => {
      // The inspector is on the RIGHT, so dragging left widens it.
      onWidth(startWidth - (moveEvent.clientX - startX));
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', onVisibility);
      sessionRef.current = undefined;
    };
    const onVisibility = () => { if (document.hidden) finish(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', onVisibility);
    sessionRef.current = finish;
  }, [onWidth, width]);

  return (
    <div
      className="dg-side-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the inspector"
      aria-valuenow={width}
      aria-valuemin={SIDE_WIDTH_MIN}
      aria-valuemax={SIDE_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={beginResize}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); onWidth(width + 16); }
        if (event.key === 'ArrowRight') { event.preventDefault(); onWidth(width - 16); }
        if (event.key === 'Home') { event.preventDefault(); onReset(); }
      }}
    />
  );
}
