import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ControlChips } from '../nodes/ControlChips';
import type { DiagramFlowEdge, EdgeLayoutEdit } from '../buildGraph';
import {
  orthogonalVerticesFromPath,
  pointAlongSmoothStepPath,
  projectPointOntoPolyline,
  sampledPathPoints,
  type Point,
} from './pathPoint';
import { setEdgeRouteDragging, useEdgeRoute } from './useEdgeRoutes';

/** Edge-drag pipeline counters — debugging surface (see __edgeRouteStats). */
const dragDebug = {
  movesSeen: 0, idMismatch: 0, commits: 0, cleanups: 0, begins: 0,
  hasHandler: undefined as boolean | undefined,
};
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__edgeDragDebug = dragDebug;
}

interface DragSession {
  pointerId: number;
  cleanup: () => void;
}

/**
 * MODULE-level, not a ref: the commit that starts a waypoint insert re-renders
 * the app and React Flow REMOUNTS the edge component ~9ms into the drag
 * (probe-logged: begin@64713 -> effect-cleanup@64722), so an instance-owned
 * session was destroyed before the first pointermove ever arrived — manual
 * edge editing silently never worked. The session must outlive the instance;
 * pointerup/pointercancel/blur/visibilitychange and edit-mode exit end it.
 */
let activeDragSession: DragSession | undefined;

/**
 * Ends any in-flight edge drag. Exported because the session outlives the
 * component on purpose, so the only places that can know it should stop —
 * leaving edit mode, switching diagram — are outside this file.
 */
export function cancelEdgeDrag(): void {
  activeDragSession?.cleanup();
}

function transformAt(point: Point): string {
  return `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`;
}

/**
 * Click-versus-drag on the edge label, stated numerically because the label's
 * pointer-down is ALSO the reposition-drag trigger (a mechanism with a
 * documented prior dead-drag defect, so it is extended rather than replaced):
 * movement under LABEL_CLICK_SLOP never starts a drag, and a release inside
 * that slop within LABEL_CLICK_MS selects the edge instead. Anything past
 * either threshold is a reposition drag exactly as before.
 */
const LABEL_CLICK_SLOP = 4;
const LABEL_CLICK_MS = 300;

export function FloatingDiagramEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<DiagramFlowEdge>) {
  const { screenToFlowPosition, getZoom } = useReactFlow();
  const routed = useEdgeRoute(id);
  const [fallbackPath, fallbackLabelX, fallbackLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
    offset: 24,
  });
  const fallbackFraction = data?.edgeEdit?.labelFraction ?? data?.positionFraction ?? 0.5;
  const path = routed?.path ?? fallbackPath;
  const pathPoints = routed?.points
    ?? orthogonalVerticesFromPath(fallbackPath, { x: sourceX, y: sourceY });
  const labelFraction = routed?.labelFraction ?? fallbackFraction;
  const labelPosition = routed?.labelPosition ?? pointAlongSmoothStepPath(
    fallbackPath,
    fallbackFraction,
    { x: fallbackLabelX, y: fallbackLabelY },
  );
  const interaction = data?.interaction ?? 'rest';
  const kind = data?.def.kind ?? 'flow';
  const islandClass = data?.isIsland ? ' is-island' : '';
  const edgeColor = data?.edgeEdit?.color;
  const labelScale = data?.edgeEdit?.labelScale;
  const pathClass = `dg-edge-path dg-floating-edge is-${interaction} is-${kind}${islandClass}`
    + (selected ? ' is-selected' : '');
  const pathStyle: CSSProperties | undefined = edgeColor ? { stroke: edgeColor } : undefined;
  const labelStyleVars = {
    ...(labelScale !== undefined ? { '--dg-label-scale': String(labelScale) } : {}),
    ...(edgeColor ? { '--dg-edge-ink': edgeColor } : {}),
  } as CSSProperties;
  const editMode = data?.editMode ?? false;
  const waypoints = data?.edgeEdit?.waypoints ?? [];
  const sampledPoints = useMemo(
    () => sampledPathPoints(path, pathPoints[0] ?? { x: sourceX, y: sourceY }),
    [path, pathPoints, sourceX, sourceY],
  );

  useEffect(() => {
    // Exiting edit mode cancels an in-flight edge drag. There is deliberately
    // NO unmount cleanup: the edge component remounts mid-drag (see
    // activeDragSession above) and an unmount cancel kills every drag at
    // its first frame.
    if (!editMode) activeDragSession?.cleanup();
  }, [editMode]);

  const commitEdit = useCallback((edit: EdgeLayoutEdit) => {
    dragDebug.commits += 1;
    data?.onEdgeEdit?.(id, edit);
  }, [data, id]);

  const beginDrag = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    onMove: (point: Point) => void,
    onEnd?: () => void,
  ) => {
    // Primary pointer only. Middle- and right-button presses on a label were
    // being captured as edit gestures, so a right-click could select the edge
    // instead of doing what a right-click does (cross-vendor review,
    // 2026-09-15). Middle and right drag the canvas in edit mode.
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    activeDragSession?.cleanup();
    dragDebug.begins += 1;
    const pointerId = event.pointerId;
    // Light-mode signal: without it every waypoint/label move ran the FULL
    // route+label pass per pointer frame (same defect class as node drags,
    // fixed 2026-08-20). onEnd re-commits the final value AFTER the flag
    // drops so exactly one full pass runs, on release.
    setEdgeRouteDragging(true);
    let ended = false;
    const move = (moveEvent: PointerEvent) => {
      dragDebug.movesSeen += 1;
      if (moveEvent.pointerId !== pointerId) { dragDebug.idMismatch += 1; return; }
      moveEvent.preventDefault();
      onMove(screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY }));
    };
    const cleanup = () => {
      dragDebug.cleanups += 1;
      window.removeEventListener('pointermove', move, { capture: true });
      window.removeEventListener('pointerup', finish, { capture: true });
      window.removeEventListener('pointercancel', finish, { capture: true });
      window.removeEventListener('blur', cleanup);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (activeDragSession?.pointerId === pointerId) activeDragSession = undefined;
      setEdgeRouteDragging(false);
      if (!ended) {
        ended = true;
        onEnd?.();
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) cleanup();
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === pointerId) cleanup();
    };
    // Capture phase is defensive: nothing downstream can starve the drag by
    // stopping propagation. (The original dead-drag defect was the unmount
    // cleanup killing the session — see activeDragSession — not propagation.)
    window.addEventListener('pointermove', move, { passive: false, capture: true });
    window.addEventListener('pointerup', finish, { capture: true });
    window.addEventListener('pointercancel', finish, { capture: true });
    window.addEventListener('blur', cleanup);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    activeDragSession = { pointerId, cleanup };
  }, [screenToFlowPosition]);

  const beginWaypointDrag = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    index: number,
    initialWaypoints: Point[],
  ) => {
    const moving = initialWaypoints.map((point) => ({ ...point }));
    beginDrag(event, (point) => {
      moving[index] = point;
      commitEdit({ ...data?.edgeEdit, waypoints: moving.map((waypoint) => ({ ...waypoint })) });
    }, () => {
      commitEdit({ ...data?.edgeEdit, waypoints: moving.map((waypoint) => ({ ...waypoint })) });
    });
  }, [beginDrag, commitEdit, data?.edgeEdit]);

  const segmentHandles = pathPoints.slice(1).map((point, index) => {
    const start = pathPoints[index];
    const midpoint = { x: (start.x + point.x) / 2, y: (start.y + point.y) / 2 };
    const fraction = projectPointOntoPolyline(sampledPoints, midpoint).fraction;
    const waypointFractions = waypoints.map((waypoint) => (
      projectPointOntoPolyline(sampledPoints, waypoint).fraction
    ));
    const before = waypointFractions.findIndex((waypointFraction) => waypointFraction > fraction);
    return { midpoint, insertIndex: before === -1 ? waypoints.length : before };
  });

  const beginLabelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    let lastFraction: number | undefined;
    let moved = false;
    const startedAt = performance.now();
    // The slop is a SCREEN distance, so it converts through the current zoom:
    // 4px of hand tremor must read as a click whether the canvas is at 20% or
    // 200%.
    const slop = LABEL_CLICK_SLOP / Math.max(0.0001, getZoom());
    const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const additive = event.shiftKey;
    beginDrag(event, (point) => {
      if (!moved) {
        if (Math.hypot(point.x - origin.x, point.y - origin.y) < slop) return;
        moved = true;
      }
      const fraction = projectPointOntoPolyline(sampledPoints, point).fraction;
      lastFraction = Math.min(0.95, Math.max(0.05, fraction));
      commitEdit({ ...data?.edgeEdit, labelFraction: lastFraction });
    }, () => {
      if (!moved) {
        // Never left the slop: a click, not a reposition. A slow press-and-
        // hold is neither — it does nothing, the same as before.
        if (performance.now() - startedAt <= LABEL_CLICK_MS) {
          data?.onEdgeSelect?.(id, additive);
        }
        return;
      }
      if (lastFraction !== undefined) {
        commitEdit({ ...data?.edgeEdit, labelFraction: lastFraction });
      }
    });
  }, [beginDrag, commitEdit, data, getZoom, id, sampledPoints, screenToFlowPosition]);

  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        className={pathClass}
        style={pathStyle}
        data-edge-id={id}
        data-source={source}
        data-target={target}
        // Edit mode narrows the invisible hit corridor. The wide one existed
        // to make lines easy to hover in view mode; in edit mode it competes
        // with group drags, and the narrower corridor plus `pointer-events:
        // stroke` (diagrams.css) keeps lines clickable without swallowing a
        // pointer-down meant for the group beneath.
        interactionWidth={editMode ? 10 : 20}
      />
      {(data?.def.label || !!data?.def.controls?.length || editMode) && (
        <EdgeLabelRenderer>
          {(data?.def.label || !!data?.def.controls?.length) && (
            <div
              className={`${data?.def.label ? 'dg-edge-label' : 'dg-edge-annotation'} is-${interaction}${islandClass}${editMode ? ' is-editable nopan' : ''}`}
              data-edge-id={id}
              style={{ ...labelStyleVars, transform: transformAt(labelPosition) }}
              role={editMode ? 'slider' : undefined}
              aria-label={editMode ? `Move ${data?.def.label ? 'label' : 'control tags'} for edge ${id}` : undefined}
              aria-valuemin={editMode ? 0.05 : undefined}
              aria-valuemax={editMode ? 0.95 : undefined}
              aria-valuenow={editMode ? labelFraction : undefined}
              onPointerDown={editMode ? beginLabelDrag : undefined}
            >
              {data?.def.label}
              <ControlChips controls={data?.def.controls} />
            </div>
          )}
          {editMode && segmentHandles.map(({ midpoint, insertIndex }, index) => (
            <button
              className="dg-edge-edit-handle dg-edge-midpoint-handle nopan"
              key={`midpoint-${index}`}
              type="button"
              aria-label={`Insert waypoint on edge ${id}`}
              style={{ transform: transformAt(midpoint) }}
              onPointerDown={(event) => {
                const inserted = [
                  ...waypoints.slice(0, insertIndex),
                  midpoint,
                  ...waypoints.slice(insertIndex),
                ];
                commitEdit({ ...data?.edgeEdit, waypoints: inserted });
                beginWaypointDrag(event, insertIndex, inserted);
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ))}
          {editMode && waypoints.map((waypoint, index) => (
            <button
              className="dg-edge-edit-handle dg-edge-waypoint-handle nopan"
              key={`waypoint-${index}`}
              type="button"
              aria-label={`Move waypoint ${index + 1} on edge ${id}; double-click to remove`}
              style={{ transform: transformAt(waypoint) }}
              onPointerDown={(event) => beginWaypointDrag(event, index, waypoints)}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const next = waypoints.filter((_, waypointIndex) => waypointIndex !== index);
                commitEdit({
                  ...data?.edgeEdit,
                  waypoints: next.length > 0 ? next : undefined,
                });
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
