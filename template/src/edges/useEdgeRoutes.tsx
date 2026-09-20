import {
  Position,
  getSmoothStepPath,
  useStore,
} from '@xyflow/react';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { DiagramFlowEdge, DiagramGroupNode, DiagramLeafNode } from '../buildGraph';
import { CONTROL_CHIP_ROW_H, controlChipRows, controlChipsWidth, groupHeaderHeight } from '../layout';

/** Rendered size of the collapsed "+ notes" affordance (embed mode only). */
const NOTE_CHIP_W = 58;
const NOTE_CHIP_H = 20;
import {
  orthogonalVerticesFromPath,
  pointAlongSmoothStepPath,
  roundedOrthogonalPath,
  sampledPathPoints,
} from './pathPoint';
import {
  edgeAnchors,
  inflateRect,
  orthogonaliseManualRoute,
  routeOrthogonal,
  segmentCrossesRect,
  type EdgeAnchors,
  type Point,
  type Rect,
  type RoutingObstacle,
  type Side,
} from './router';

interface NodeSnapshot {
  id: string;
  type?: string;
  rect: Rect;
  /** The "+ notes" chip hanging under the card, when embed mode renders one.
   *  Chrome the reader clicks — an edge label sitting on it is a defect the
   *  geometric probe cannot see, so the placer scores it as an obstacle. */
  noteRect?: Rect;
}

interface EdgeSnapshot {
  id: string;
  source: string;
  target: string;
  /** 'floating' edges get obstacle routing; 'aws' edges keep their
   *  smoothstep path and join the pass for automatic LABEL placement only. */
  dialect: 'floating' | 'aws';
  /** aws dialect: fixed handle sides from buildGraph's fixedHandles. */
  sourceSide?: Side;
  targetSide?: Side;
  label?: string;
  /** aws dialect: the chip renders this many px BELOW the placed point when a
   *  step marker occupies the point itself (AwsEdge's +18 offset) — the
   *  placer must score the rect where the chip actually renders. */
  labelOffsetY: number;
  positionFraction?: number;
  waypoints?: Point[];
  labelFraction?: number;
  /** True when a numbered step circle renders AT the placed point. */
  hasStepMarker?: boolean;
  /** Chip row rendered UNDER the label; part of the rect the placer must keep
   *  clear. An unscored chip row puts control chips straight onto the
   *  neighbouring card. */
  controls?: string[];
  /**
   * The label's RENDERED text scale — the canvas scale times any per-label
   * override. Every number in estimateLabelRect is derived from the 9.5px
   * default, so a placer blind to this models a 1x chip, sites the label in a
   * gap only a 1x chip fits, and the real chip lands on a card. Caught by the
   * scaled probe run at 1.6x on all three diagrams, 2026-09-15.
   */
  labelScale: number;
}

interface RouteStoreSlice {
  nodes: NodeSnapshot[];
  /** Group HEADER bands (title + owner/status chips). Opaque chrome: an edge
   *  label or chip row landing on one is a defect, so they are obstacles for
   *  LABEL placement only — never for path routing, which must be free to
   *  enter a group. */
  headerBands: Rect[];
  edges: EdgeSnapshot[];
  /** Painted chrome that carries no card of its own but must not be written
   *  over — today the csdm hub. Label obstacles AND path obstacles: an arrow
   *  through the Manage Portfolio circle reads as a mistake. */
  chrome: Rect[];
  /** True while any node is being dragged — routing runs in cheap light mode
   *  and the full pass is deferred to drag end (971ms full computes were
   *  running per drag frame on the 122-node diagram, measured 2026-08-20). */
  dragging: boolean;
}

export interface EdgeRoute {
  path: string;
  /** Square-corner vertices used for edit handles. */
  points: Point[];
  anchors: EdgeAnchors;
  labelFraction: number;
  labelPosition: Point;
  /** aws step-marker edges: the text chip's own position, decoupled from the
   *  marker circle (which must stay on the path). Absent = chip renders at
   *  the dialect's default offset from labelPosition. */
  labelChipPosition?: Point;
}

const EMPTY_ROUTES = new Map<string, EdgeRoute>();
const EdgeRoutesContext = createContext<ReadonlyMap<string, EdgeRoute>>(EMPTY_ROUTES);
const LEAF_TYPES = new Set(['diagramNode', 'awsTile', 'pyramidBar', 'csdmCard']);
const ROUTE_MARGIN = 14;
const LABEL_TOLERANCE = 4;
/** Radius of the numbered step circle (.dg-step-marker is 20px across). */
const STEP_MARKER_R = 10;
const STEP_MARKER_PAD = 5;
/**
 * Default drop of the text chip below a step circle, and the ONE exported
 * constant for it: the snapshot, the displacement ring and the edge component
 * all read this. At the old 18 the chip, which paints above the marker,
 * erased the bottom of its own numbered circle — radius 10 plus half a chip
 * is the floor.
 */
export const STEP_CHIP_DROP = 26;

function markerRect(point: Point): Rect {
  const half = STEP_MARKER_R + STEP_MARKER_PAD;
  return { x: point.x - half, y: point.y - half, width: half * 2, height: half * 2 };
}

function handleSide(handle: string | null | undefined): Side | undefined {
  const side = handle?.split('-')[0];
  return side === 'left' || side === 'right' || side === 'top' || side === 'bottom'
    ? side
    : undefined;
}

function edgeSnapshot(edge: DiagramFlowEdge): EdgeSnapshot {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    dialect: edge.type === 'aws' ? 'aws' : 'floating',
    sourceSide: handleSide(edge.sourceHandle),
    targetSide: handleSide(edge.targetHandle),
    label: edge.data?.def.label,
    labelOffsetY: edge.type === 'aws' && edge.data?.def.stepNo !== undefined ? STEP_CHIP_DROP : 0,
    positionFraction: edge.data?.positionFraction,
    waypoints: edge.data?.edgeEdit?.waypoints,
    labelFraction: edge.data?.edgeEdit?.labelFraction,
    controls: edge.data?.def.controls,
    labelScale: (edge.data?.textScale ?? 1) * (edge.data?.edgeEdit?.labelScale ?? 1),
    hasStepMarker: edge.type === 'aws' && edge.data?.def.stepNo !== undefined,
  };
}

/** Set from App's onNodesChange (position changes carry `dragging`) — the
 *  internal nodeLookup does not reliably expose a dragging flag, so the
 *  interaction layer owns this signal. */
let interactionDragging = false;
export function setEdgeRouteDragging(value: boolean): void {
  interactionDragging = value;
}

function noteChipRect(node: {
  type?: string;
  internals: { positionAbsolute: Point };
  measured?: { width?: number; height?: number };
  width?: number; height?: number;
  data: DiagramLeafNode['data'];
}): Rect | undefined {
  if (!node.data?.embedMode || !node.data?.def?.detail) return undefined;
  const width = node.measured?.width ?? node.width ?? 132;
  const height = node.measured?.height ?? node.height ?? 64;
  const left = node.type === 'awsTile'
    ? node.internals.positionAbsolute.x + width / 2 - NOTE_CHIP_W / 2
    : node.internals.positionAbsolute.x + 10;
  return {
    x: left,
    y: node.internals.positionAbsolute.y + height + 9,
    width: NOTE_CHIP_W,
    height: NOTE_CHIP_H,
  };
}

const selectRouteInputs = (state: Parameters<Parameters<typeof useStore>[0]>[0]): RouteStoreSlice => ({
  dragging: interactionDragging,
  nodes: [...state.nodeLookup.values()]
    .filter((node) => LEAF_TYPES.has(node.type ?? ''))
    .map((node) => ({
      id: node.id,
      type: node.type,
      rect: {
        x: node.internals.positionAbsolute.x,
        y: node.internals.positionAbsolute.y,
        width: node.measured.width ?? node.width ?? 132,
        height: node.measured.height ?? node.height ?? 64,
      },
      noteRect: noteChipRect(node as unknown as {
        type?: string;
        internals: { positionAbsolute: Point };
        measured?: { width?: number; height?: number };
        width?: number; height?: number;
        data: DiagramLeafNode['data'];
      }),
    }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  chrome: [...state.nodeLookup.values()]
    .filter((node) => node.type === 'csdmHub')
    .map((node) => ({
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
      width: node.measured?.width ?? node.width ?? 0,
      height: node.measured?.height ?? node.height ?? 0,
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y),
  headerBands: [...state.nodeLookup.values()]
    .filter((node) => node.type === 'diagramGroup' || node.type === 'csdmRegion')
    .map((node) => ({
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
      width: node.measured?.width ?? node.width ?? 240,
      height: groupHeaderHeight((node as unknown as DiagramGroupNode).data.def),
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y),
  edges: (state.edges as DiagramFlowEdge[])
    .filter((edge) => edge.type === 'floating' || edge.type === 'aws')
    .map(edgeSnapshot)
    .sort((a, b) => a.id.localeCompare(b.id)),
});

/** Length-prefixed so no tag content can forge equality across arrays. */
function controlsKey(controls?: string[]): string {
  return (controls ?? []).map((tag) => `${tag.length}:${tag}`).join(',');
}

function pointsEqual(a: Point[] | undefined, b: Point[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((point, index) => point.x === b[index].x && point.y === b[index].y);
}

function routeInputsEqual(a: RouteStoreSlice, b: RouteStoreSlice): boolean {
  if (a.dragging !== b.dragging) return false;
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  if (a.headerBands.length !== b.headerBands.length) return false;
  if (a.chrome.length !== b.chrome.length) return false;
  const chromeEqual = a.chrome.every((rect, index) => {
    const other = b.chrome[index];
    return rect.x === other.x && rect.y === other.y
      && rect.width === other.width && rect.height === other.height;
  });
  if (!chromeEqual) return false;
  const bandsEqual = a.headerBands.every((band, index) => {
    const other = b.headerBands[index];
    return band.x === other.x && band.y === other.y
      && band.width === other.width && band.height === other.height;
  });
  if (!bandsEqual) return false;
  const nodesEqual = a.nodes.every((node, index) => {
    const other = b.nodes[index];
    return node.id === other.id
      && node.type === other.type
      && node.rect.x === other.rect.x
      && node.rect.y === other.rect.y
      && node.rect.width === other.rect.width
      && node.rect.height === other.rect.height
      && node.noteRect?.x === other.noteRect?.x
      && node.noteRect?.y === other.noteRect?.y
      && node.noteRect?.width === other.noteRect?.width
      && node.noteRect?.height === other.noteRect?.height;
  });
  if (!nodesEqual) return false;
  return a.edges.every((edge, index) => {
    const other = b.edges[index];
    return edge.id === other.id
      && edge.source === other.source
      && edge.target === other.target
      && edge.dialect === other.dialect
      && edge.sourceSide === other.sourceSide
      && edge.targetSide === other.targetSide
      && edge.label === other.label
      && edge.labelScale === other.labelScale
      && edge.labelOffsetY === other.labelOffsetY
      && edge.positionFraction === other.positionFraction
      && edge.labelFraction === other.labelFraction
      && edge.hasStepMarker === other.hasStepMarker
      && controlsKey(edge.controls) === controlsKey(other.controls)
      && pointsEqual(edge.waypoints, other.waypoints);
  });
}

function positionForSide(side: Side): Position {
  if (side === 'left') return Position.Left;
  if (side === 'right') return Position.Right;
  if (side === 'top') return Position.Top;
  return Position.Bottom;
}

function lineIntersectsRect(start: Point, end: Point, rect: Rect): boolean {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let near = 0;
  let far = 1;
  const checks: Array<[number, number]> = [
    [-dx, start.x - left],
    [dx, right - start.x],
    [-dy, start.y - top],
    [dy, bottom - start.y],
  ];
  for (const [direction, distance] of checks) {
    if (Math.abs(direction) < 0.001) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

function pathIntersectsObstacles(path: string, obstacles: RoutingObstacle[], fallback: Point): boolean {
  const samples = sampledPathPoints(path, fallback);
  for (let index = 1; index < samples.length; index += 1) {
    if (obstacles.some((obstacle) => lineIntersectsRect(samples[index - 1], samples[index], obstacle))) {
      return true;
    }
  }
  return false;
}

function sideMidpoint(rect: Rect, side: Side): Point {
  if (side === 'left') return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === 'right') return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === 'top') return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function simplePath(anchors: EdgeAnchors): { path: string; points: Point[]; midpoint: Point } {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: anchors.source.x,
    sourceY: anchors.source.y,
    targetX: anchors.target.x,
    targetY: anchors.target.y,
    sourcePosition: positionForSide(anchors.sourceSide),
    targetPosition: positionForSide(anchors.targetSide),
    borderRadius: 12,
    offset: 24,
  });
  return {
    path,
    points: orthogonalVerticesFromPath(path, anchors.source),
    midpoint: { x: labelX, y: labelY },
  };
}

/**
 * The rect the placer must keep clear: the label chip UNION its control-chip
 * row, which CSS hangs 4px below the label, centred. Scoring the label alone
 * let a two-chip row sit squarely on the next card.
 */
function estimateLabelRect(
  label: string,
  centrePoint: Point,
  controls?: string[],
  /** Rendered text scale; every constant below is a 1x measurement. */
  labelScale = 1,
): Rect {
  const charW = 6.5 * labelScale;
  const lineBox = 218 * labelScale;
  const textWidth = label.length * charW;
  const naturalWidth = textWidth + 22;
  // +6/+3 safety margin: the estimate must err conservative — an estimate a
  // few px under the rendered chip re-admits the collisions the placer exists
  // to prevent (probe-verified against rendered DOM rects).
  const width = Math.min(246 * labelScale, Math.max(42, naturalWidth)) + 6;
  // Word-boundary wrapping, not a character-count division: a chip of three
  // long words wraps to three lines where `ceil(textWidth / 218)` predicts
  // two, and an under-estimated rect re-admits the collisions this placer
  // exists to prevent. Greedy pack at the same 6.5px/char the width uses.
  // Both estimates, whichever is larger — the character-count division stays
  // as the floor because a single word wider than the line box overflows
  // rather than wrapping, and the estimate must never come in UNDER what CSS
  // paints.
  const lines = Math.max(1, Math.ceil(textWidth / lineBox), label.split(/\s+/).filter(Boolean).reduce((state, word) => {
    const wordWidth = word.length * charW;
    if (state.used === 0) return { count: state.count, used: wordWidth };
    if (state.used + charW + wordWidth <= lineBox) return { count: state.count, used: state.used + charW + wordWidth };
    return { count: state.count + 1, used: wordWidth };
  }, { count: 1, used: 0 }).count);
  const height = lines * 14.25 * labelScale + 8 + 3;
  const rect = {
    x: centrePoint.x - width / 2,
    y: centrePoint.y - height / 2,
    width,
    height,
  };
  const chipRows = controlChipRows(controls).length;
  if (!chipRows) return rect;
  // The SAME width function layout.ts uses to reserve space for this row.
  // Two independently-tuned estimates of one rendered element is the defect
  // the shared-constant rule exists to prevent.
  const chipWidth = controlChipsWidth(controls);
  const left = Math.min(rect.x, centrePoint.x - chipWidth / 2);
  const right = Math.max(rect.x + rect.width, centrePoint.x + chipWidth / 2);
  return {
    x: left,
    y: rect.y,
    width: right - left,
    height: rect.height + 4 + chipRows * CONTROL_CHIP_ROW_H,
  };
}

function overlapAmount(a: Rect, b: Rect, tolerance: number): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > tolerance && height > tolerance ? width * height : 0;
}

interface LabelCandidate {
  fraction: number;
  position: Point;
  rect: Rect;
  cardCollision: number;
  offsetMagnitude: number;
}

/**
 * Candidate generation for automatic label placement: fractions ALONG the
 * path and, per fraction, a small set of PERPENDICULAR offsets from it. The
 * offset tier is what wins on short edges between adjacent cards, where the
 * corridor is narrower than the chip and no on-path candidate can clear the
 * endpoint cards (probe-verified failure class, BUILD-SPEC-3 remediation
 * 2026-08-20). Card collision is precomputed here; label-label collision is
 * scored at selection time against the labels already placed.
 */
function labelCandidates(
  path: string,
  midpoint: Point,
  label: string,
  cards: Rect[],
  allowOffset: boolean,
  labelOffsetY: number,
  controls?: string[],
  /** Step-marker edges: the numbered CIRCLE renders at the chosen point and
   *  cannot be offset from it, so its own footprint must be scored against
   *  the obstacle set as well as the chip's (the chip is re-sited later by
   *  placeAwsChip). Scoring only the chip left circles on card titles and on
   *  group header bands — defects the geometric probe does not measure. */
  markerMode = false,
  /** Rendered text scale of this label; see EdgeSnapshot.labelScale. */
  labelScale = 1,
): LabelCandidate[] {
  const fractions: number[] = [0.5];
  for (let fraction = 0.03; fraction <= 0.971; fraction += 0.02) {
    fractions.push(Number(fraction.toFixed(2)));
  }
  // AWS step-marker circles must stay ON the path; a chip with no circle may
  // leave it.
  // The far rungs only win when every near-path candidate is saturated — the
  // score's offset term keeps chips near the line otherwise. ±72/±88 exist
  // because two stacked multi-line chips need >58px of separation
  // (probe-diagnosed on the five-pillars corridor).
  const offsets = allowOffset
    ? [0, -14, 14, -24, 24, -34, 34, -46, 46, -58, 58, -72, 72, -88, 88,
      -106, 106, -126, 126, -150, 150]
    : [0];
  const candidates: LabelCandidate[] = [];
  [...new Set(fractions)].forEach((fraction) => {
    const onPath = pointAlongSmoothStepPath(path, fraction, midpoint);
    const ahead = pointAlongSmoothStepPath(path, Math.min(1, fraction + 0.02), onPath);
    const behind = pointAlongSmoothStepPath(path, Math.max(0, fraction - 0.02), onPath);
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / length, y: dx / length };
    offsets.forEach((offset) => {
      const position = {
        x: onPath.x + normal.x * offset,
        y: onPath.y + normal.y * offset,
      };
      const rect = estimateLabelRect(label, {
        x: position.x,
        y: position.y + labelOffsetY,
      }, controls, labelScale);
      const marker = markerMode ? markerRect(position) : undefined;
      const cardCollision = cards.reduce(
        // The circle is weighted above the chip: the chip is re-sited by
        // placeAwsChip in phase 3, so its rect here is only a reservation,
        // while the circle is stuck exactly where this fraction puts it.
        (sum, card) => sum + overlapAmount(rect, card, LABEL_TOLERANCE)
          + (marker ? overlapAmount(marker, card, 0) * 8 : 0),
        0,
      );
      candidates.push({
        fraction,
        position,
        rect,
        cardCollision,
        offsetMagnitude: Math.abs(offset),
      });
    });
  });
  return candidates;
}

/** Placement diagnostics, keyed by edge id — a tuning surface for the layout
 *  probe workflow (read via page.evaluate; negligible cost to maintain). */
const placementDebug: Record<string, {
  cardCollision: number; labelCollision: number; fraction: number;
}> = {};
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__edgePlacementDebug = placementDebug;
}

/**
 * aws step-marker edges: the numbered circle must stay ON the path, but the
 * text chip need not hang exactly 18px below it — that hard coupling left
 * "Yes"/"No" chips on cards in dense flows with the placer powerless
 * (probe-verified). Search small displacements around the marker instead.
 */
function placeAwsChip(
  marker: Point,
  label: string,
  cards: Rect[],
  placedLabels: Rect[],
  controls?: string[],
  /** Every OTHER edge's placed step circle. The chip paints above a marker,
   *  so a chip sited over someone else's circle erases it — but its OWN
   *  circle is the thing it belongs to, and STEP_CHIP_DROP is already
   *  derived to clear that circle's painted radius. Including it made the
   *  intended default position score as a collision and pushed every chip
   *  further from its own marker than the design intends. */
  markers: Rect[] = [],
  labelScale = 1,
): { position: Point; rect: Rect } {
  // Ordered near-to-far: the index term in the score keeps the chip as close
  // to its marker as a clean spot allows. The far rings exist because a chip
  // can now carry a control-chip row under it, so the near ring saturates on
  // dense compositions (probe-diagnosed).
  const displacements: Point[] = [
    { x: 0, y: STEP_CHIP_DROP }, { x: 0, y: -30 }, { x: 36, y: 0 }, { x: -36, y: 0 },
    { x: 36, y: STEP_CHIP_DROP }, { x: -36, y: STEP_CHIP_DROP }, { x: 0, y: 36 }, { x: 48, y: 0 },
    { x: -48, y: 0 }, { x: 0, y: -38 }, { x: 62, y: 0 }, { x: -62, y: 0 },
    { x: 0, y: 52 }, { x: 0, y: -52 }, { x: 48, y: 34 }, { x: -48, y: 34 },
    { x: 48, y: -34 }, { x: -48, y: -34 },
    { x: 84, y: 0 }, { x: -84, y: 0 }, { x: 0, y: 70 }, { x: 0, y: -70 },
    { x: 84, y: 40 }, { x: -84, y: 40 }, { x: 84, y: -40 }, { x: -84, y: -40 },
    { x: 116, y: 0 }, { x: -116, y: 0 }, { x: 0, y: 92 }, { x: 0, y: -92 },
    { x: 116, y: 56 }, { x: -116, y: 56 }, { x: 116, y: -56 }, { x: -116, y: -56 },
    { x: 150, y: 0 }, { x: -150, y: 0 }, { x: 0, y: 118 }, { x: 0, y: -118 },
    { x: 150, y: 72 }, { x: -150, y: 72 }, { x: 150, y: -72 }, { x: -150, y: -72 },
    { x: 190, y: 0 }, { x: -190, y: 0 }, { x: 0, y: 150 }, { x: 0, y: -150 },
    { x: 190, y: 90 }, { x: -190, y: 90 }, { x: 190, y: -90 }, { x: -190, y: -90 },
  ];
  let best: { position: Point; rect: Rect; score: number } | undefined;
  displacements.forEach((displacement, index) => {
    const position = { x: marker.x + displacement.x, y: marker.y + displacement.y };
    const rect = estimateLabelRect(label, position, controls, labelScale);
    const cardCollision = cards.reduce(
      (sum, card) => sum + overlapAmount(rect, card, LABEL_TOLERANCE),
      0,
    ) + markers.reduce((sum, circle) => sum + overlapAmount(rect, circle, 0), 0);
    const labelCollision = placedLabels.reduce(
      (sum, placed) => sum + overlapAmount(rect, placed, 1),
      0,
    );
    const score = cardCollision * 100000 + labelCollision * 400 + index;
    if (!best || score < best.score) best = { position, rect, score };
  });
  return best ?? { position: { x: marker.x, y: marker.y + STEP_CHIP_DROP }, rect: estimateLabelRect(label, marker, controls, labelScale) };
}

function computeRoutes(slice: RouteStoreSlice): ReadonlyMap<string, EdgeRoute> {
  const cardsById = new Map(slice.nodes.map((node) => [node.id, node.rect]));
  const inflatedObstacles: RoutingObstacle[] = [
    ...slice.nodes.map((node) => ({ id: node.id, ...inflateRect(node.rect, ROUTE_MARGIN) })),
    // Chrome carries an id no edge endpoint can match, so it is an obstacle
    // for every edge and an endpoint for none.
    ...slice.chrome.map((rect, index) => ({
      id: `__chrome-${index}`,
      ...inflateRect(rect, ROUTE_MARGIN),
    })),
  ];
  const preliminary = new Map<string, Omit<EdgeRoute, 'labelFraction' | 'labelPosition'> & {
    midpoint: Point;
  }>();

  slice.edges.forEach((edge) => {
    const sourceRect = cardsById.get(edge.source);
    const targetRect = cardsById.get(edge.target);
    if (!sourceRect || !targetRect) return;
    if (edge.dialect === 'aws') {
      // AWS edges keep their fixed-handle smoothstep path (no obstacle
      // routing this pass) but join the pass so the automatic label placer
      // covers them — their "Yes"/"Accept" style chips were landing on
      // cards with no mechanism to move them (probe-verified).
      const sourceSide = edge.sourceSide ?? 'right';
      const targetSide = edge.targetSide ?? 'left';
      const sourceAnchor = sideMidpoint(sourceRect, sourceSide);
      const targetAnchor = sideMidpoint(targetRect, targetSide);
      const anchors: EdgeAnchors = {
        source: sourceAnchor,
        target: targetAnchor,
        // Stubs feed the obstacle router only, which aws edges never enter.
        sourceStub: sourceAnchor,
        targetStub: targetAnchor,
        sourceSide,
        targetSide,
      };
      const [path, labelX, labelY] = getSmoothStepPath({
        sourceX: anchors.source.x,
        sourceY: anchors.source.y,
        targetX: anchors.target.x,
        targetY: anchors.target.y,
        sourcePosition: positionForSide(sourceSide),
        targetPosition: positionForSide(targetSide),
        borderRadius: 8,
        offset: 20,
      });
      preliminary.set(edge.id, {
        path,
        points: orthogonalVerticesFromPath(path, anchors.source),
        anchors,
        midpoint: { x: labelX, y: labelY },
      });
      return;
    }

    const anchors = edgeAnchors(sourceRect, targetRect);
    const direct = simplePath(anchors);
    // Corridor pruning: the Hanan grid is built from obstacle bound
    // coordinates, so its size — and the A* cost — is quadratic-ish in the
    // obstacle count. On the 122-node diagram, feeding ALL cards to every
    // edge cost ~971ms per full compute (measured); only obstacles near the
    // edge's own corridor can matter. A route that wandered outside the
    // corridor past a pruned card would be caught by the probe's
    // edge-through-card gate.
    const corridorMargin = 160;
    const corridor = {
      x: Math.min(sourceRect.x, targetRect.x) - corridorMargin,
      y: Math.min(sourceRect.y, targetRect.y) - corridorMargin,
      width: Math.max(sourceRect.x + sourceRect.width, targetRect.x + targetRect.width)
        - Math.min(sourceRect.x, targetRect.x) + corridorMargin * 2,
      height: Math.max(sourceRect.y + sourceRect.height, targetRect.y + targetRect.height)
        - Math.min(sourceRect.y, targetRect.y) + corridorMargin * 2,
    };
    const inCorridor = (rect: Rect) => rect.x < corridor.x + corridor.width
      && rect.x + rect.width > corridor.x
      && rect.y < corridor.y + corridor.height
      && rect.y + rect.height > corridor.y;
    const obstacles = inflatedObstacles.filter((obstacle) => (
      obstacle.id !== edge.source && obstacle.id !== edge.target && inCorridor(obstacle)
    ));

    if (edge.waypoints && edge.waypoints.length > 0) {
      const points = orthogonaliseManualRoute(anchors, edge.waypoints);
      const path = roundedOrthogonalPath(points, 12);
      preliminary.set(edge.id, {
        path,
        points,
        anchors,
        midpoint: pointAlongSmoothStepPath(path, 0.5, direct.midpoint),
      });
      return;
    }

    if (!pathIntersectsObstacles(direct.path, obstacles, anchors.source)) {
      preliminary.set(edge.id, { ...direct, anchors });
      return;
    }

    const relaxedObstacles = [
      ...slice.nodes
        .filter((node) => node.id !== edge.source && node.id !== edge.target
          && inCorridor(node.rect))
        .map((node) => ({ id: node.id, ...inflateRect(node.rect, 4) })),
      ...slice.chrome
        .filter((rect) => inCorridor(rect))
        .map((rect, index) => ({ id: `__chrome-${index}`, ...inflateRect(rect, 4) })),
    ];
    let points = routeOrthogonal(anchors, obstacles, relaxedObstacles);
    if (points) {
      // Pruning soundness check (cross-vendor verify finding, 2026-08-20):
      // an A* route can legally leave the corridor along an in-corridor
      // obstacle's inflated bound and cross a card the pruning dropped. When
      // that happens — rare, but constructible — re-route against the FULL
      // obstacle set for this edge only.
      const prunedCards = slice.nodes.filter((node) => (
        node.id !== edge.source && node.id !== edge.target && !inCorridor(node.rect)
      ));
      const routePoints = points;
      const crossesPruned = prunedCards.some((node) => {
        const tight = inflateRect(node.rect, 2);
        for (let index = 1; index < routePoints.length; index += 1) {
          if (segmentCrossesRect(routePoints[index - 1], routePoints[index], tight)) return true;
        }
        return false;
      });
      if (crossesPruned) {
        const fullObstacles = inflatedObstacles.filter((obstacle) => (
          obstacle.id !== edge.source && obstacle.id !== edge.target
        ));
        const fullRelaxed = slice.nodes
          .filter((node) => node.id !== edge.source && node.id !== edge.target)
          .map((node) => ({ id: node.id, ...inflateRect(node.rect, 4) }));
        points = routeOrthogonal(anchors, fullObstacles, fullRelaxed) ?? points;
      }
    }
    if (!points) {
      preliminary.set(edge.id, { ...direct, anchors });
      return;
    }
    const path = roundedOrthogonalPath(points, 12);
    preliminary.set(edge.id, {
      path,
      points,
      anchors,
      midpoint: pointAlongSmoothStepPath(path, 0.5, direct.midpoint),
    });
  });

  const routes = new Map<string, EdgeRoute>();
  // The debug surface is per-computation — clear stale entries from a
  // previously rendered diagram before this pass writes its own.
  Object.keys(placementDebug).forEach((key) => delete placementDebug[key]);
  /** ownerId absent = immovable (manual override or aws chip). */
  const placedLabels: Array<{ ownerId?: string; rect: Rect }> = [];
  /** Step-circle footprints, scored separately: the circle sits at the placed
   *  POINT while the chip sits STEP_CHIP_DROP below it, so one list cannot
   *  serve both. Each carries its ownerId for the same reason label rects do:
   *  a reservation that can only be found by its coordinates is a reservation
   *  that gets re-sited onto the wrong owner the moment two coincide. */
  const placedMarkers: Array<{ ownerId: string; rect: Rect }> = [];
  /** Every reserved circle except, optionally, one edge's own. */
  const markerRects = (exceptOwnerId?: string) => placedMarkers
    .filter((entry) => entry.ownerId !== exceptOwnerId)
    .map((entry) => entry.rect);
  const reserveMarker = (ownerId: string, at: Point) => {
    const existing = placedMarkers.findIndex((entry) => entry.ownerId === ownerId);
    const rect = markerRect(at);
    if (existing > -1) placedMarkers[existing] = { ownerId, rect };
    else placedMarkers.push({ ownerId, rect });
  };
  // Every piece of chrome the placer must see. New chrome joins this list in
  // the SAME change that renders it — a rendered element the placer cannot
  // see is the defect class that costs the most to chase later.
  const cardRects = [
    ...slice.nodes.map((node) => node.rect),
    ...slice.nodes.flatMap((node) => (node.noteRect ? [node.noteRect] : [])),
    ...slice.headerBands,
    ...slice.chrome,
  ];
  const placed = new Map<string, { labelFraction: number; labelPosition?: Point }>();

  // Phase 1 — manual overrides place first: human intent is fixed and never
  // yields to the automatic placer.
  slice.edges.forEach((edge) => {
    const route = preliminary.get(edge.id);
    // An unlabelled edge still paints (a control-chip row, a numbered circle,
    // or both), so an authored fraction has to be honoured for it too — and
    // its reservation made — or the pin is silently ignored and the next chip
    // is placed against a corridor it does not know is occupied.
    if (!route || !(edge.label || edge.controls?.length || edge.hasStepMarker)) return;
    const override = edge.labelFraction ?? edge.positionFraction;
    if (override === undefined) return;
    const position = pointAlongSmoothStepPath(route.path, override, route.midpoint);
    placedLabels.push({
      // ownerId, so phase 3 can REPLACE this reservation instead of adding a
      // second one: a phantom rect double-books the corridor.
      ownerId: edge.id,
      rect: inflateRect(estimateLabelRect(edge.label ?? '', {
        x: position.x,
        y: position.y + edge.labelOffsetY,
      }, edge.controls, edge.labelScale), 4),
    });
    if (edge.hasStepMarker) reserveMarker(edge.id, position);
    placed.set(edge.id, { labelFraction: override });
  });

  // Phase 2 — automatic placements, MOST CONSTRAINED FIRST. Greedy id-order
  // let the freest edge of a shared corridor take the prime spot and left its
  // neighbour only colliding candidates (probe-diagnosed: fraction pinned at
  // 0.97 with a forced label overlap). Constrainedness = how few candidates
  // clear the cards; ties break on id for determinism.
  // An edge with NO text label still paints — a control-chip row, a numbered
  // circle, or both — so it needs a placement and a reservation like any other.
  // Filtering on `label` alone left those unplaced and unreserved, and two of
  // them sharing endpoints landed on the same point.
  const pendingAuto = slice.edges
    .filter((edge) => (edge.label || edge.controls?.length || edge.hasStepMarker)
      && preliminary.get(edge.id)
      && (edge.labelFraction ?? edge.positionFraction) === undefined)
    .map((edge) => {
      const route = preliminary.get(edge.id)!;
      const candidates = labelCandidates(
        route.path,
        route.midpoint,
        edge.label ?? '',
        cardRects,
        // Perpendicular offsets are safe wherever the placed point is not a
        // step-marker circle: aws edges WITHOUT a stepNo render only the chip,
        // so they may leave the path like a floating label. Keeping them
        // pinned to the line is what stranded labels on cards.
        edge.labelOffsetY === 0,
        edge.labelOffsetY,
        edge.controls,
        edge.hasStepMarker,
        edge.labelScale,
      );
      const freedom = candidates.filter((candidate) => candidate.cardCollision === 0).length;
      return { edge, candidates, freedom };
    })
    .sort((a, b) => a.freedom - b.freedom || a.edge.id.localeCompare(b.edge.id));

  const candidateLists = new Map(pendingAuto.map((item) => [item.edge.id, item.candidates]));
  pendingAuto.forEach(({ edge, candidates }) => {
    let best: (LabelCandidate & { labelCollision: number; score: number }) | undefined;
    candidates.forEach((candidate) => {
      const labelCollision = placedLabels.reduce(
        (sum, placedLabel) => sum + overlapAmount(candidate.rect, placedLabel.rect, 1),
        0,
      );
      const markerCollision = edge.hasStepMarker
        ? placedMarkers.reduce(
          (sum, reserved) => sum + overlapAmount(markerRect(candidate.position), reserved.rect, 0),
          0,
        )
        : 0;
      const score = candidate.cardCollision * 100000
        + markerCollision * 2000
        + labelCollision * 400
        + Math.abs(candidate.fraction - 0.5) * 100
        + candidate.offsetMagnitude * 6;
      if (!best || score < best.score) best = { ...candidate, labelCollision, score };
    });
    if (!best) return;
    placedLabels.push({ ownerId: edge.id, rect: inflateRect(best.rect, 4) });
    // The numbered circle renders AT the placed point and cannot be offset, so
    // reserve its own footprint. Two step markers landing on one another is
    // invisible to the geometric probe (it scores chips, not circles) and very
    // visible in an export.
    if (edge.hasStepMarker) reserveMarker(edge.id, best.position);
    placed.set(edge.id, { labelFraction: best.fraction, labelPosition: best.position });
    placementDebug[edge.id] = {
      cardCollision: best.cardCollision,
      labelCollision: best.labelCollision,
      fraction: best.fraction,
    };
  });

  /** Edges whose placed point carries a numbered circle, by id. */
  const markerEdges = new Map(
    slice.edges.filter((edge) => edge.hasStepMarker).map((edge) => [edge.id, edge]),
  );

  // Pair repair — greedy placement (even most-constrained-first) cannot solve
  // MUTUAL scarcity: two chips sharing one corridor must negotiate jointly.
  // For each label that ended dirty, find its dominant blocker and search the
  // two candidate sets together for a collision-free combination. Runs only
  // when a collision survived, so clean diagrams pay nothing.
  Object.entries(placementDebug).forEach(([dirtyId, debug]) => {
    if (debug.labelCollision <= 0) return;
    const dirtyEntry = placedLabels.find((entry) => entry.ownerId === dirtyId);
    const dirtyCandidates = candidateLists.get(dirtyId);
    if (!dirtyEntry || !dirtyCandidates) return;
    let blocker: { ownerId?: string; rect: Rect } | undefined;
    let blockerOverlap = 0;
    placedLabels.forEach((entry) => {
      if (entry === dirtyEntry) return;
      const overlap = overlapAmount(dirtyEntry.rect, entry.rect, 1);
      if (overlap > blockerOverlap) { blockerOverlap = overlap; blocker = entry; }
    });
    if (!blocker?.ownerId) return; // immovable blocker (manual/chip) — least-bad stands
    const blockerCandidates = candidateLists.get(blocker.ownerId);
    if (!blockerCandidates) return;
    const others = placedLabels.filter((entry) => entry !== dirtyEntry && entry !== blocker);
    const cleanDirty = dirtyCandidates.filter((candidate) => candidate.cardCollision === 0);
    const cleanBlocker = blockerCandidates.filter((candidate) => candidate.cardCollision === 0);
    let bestPair:
      | { a: LabelCandidate; b: LabelCandidate; overlap: number; score: number }
      | undefined;
    cleanBlocker.forEach((a) => {
      const aRect = inflateRect(a.rect, 4);
      const aOthers = others.reduce(
        (sum, entry) => sum + overlapAmount(aRect, entry.rect, 1),
        0,
      );
      cleanDirty.forEach((b) => {
        const bRect = inflateRect(b.rect, 4);
        const mutual = overlapAmount(aRect, bRect, 1);
        const bOthers = others.reduce(
          (sum, entry) => sum + overlapAmount(bRect, entry.rect, 1),
          0,
        );
        const overlap = mutual + aOthers + bOthers;
        const score = overlap * 400
          + (Math.abs(a.fraction - 0.5) + Math.abs(b.fraction - 0.5)) * 100
          + (a.offsetMagnitude + b.offsetMagnitude) * 6;
        if (!bestPair || score < bestPair.score) bestPair = { a, b, overlap, score };
      });
    });
    if (!bestPair) return;
    const currentOverlap = (placementDebug[blocker.ownerId]?.labelCollision ?? 0)
      + debug.labelCollision;
    if (bestPair.overlap >= currentOverlap) return; // no improvement — keep least-bad
    // A repaired step-marker edge moves its CIRCLE too, so the reservation
    // made for the old point has to move with it — otherwise the next chip is
    // sited against a circle that is no longer there, and over one that is.
    // Keyed by OWNER, never by coordinates: two circles that happen to share a
    // point would otherwise re-site the wrong one and strand the other as a
    // permanent phantom obstacle for the rest of the pass.
    const repairedMarker = (ownerId: string | undefined, to: Point) => {
      if (!ownerId || !markerEdges.has(ownerId)) return;
      reserveMarker(ownerId, to);
    };
    repairedMarker(blocker.ownerId, bestPair.a.position);
    repairedMarker(dirtyId, bestPair.b.position);
    blocker.rect = inflateRect(bestPair.a.rect, 4);
    dirtyEntry.rect = inflateRect(bestPair.b.rect, 4);
    placed.set(blocker.ownerId, {
      labelFraction: bestPair.a.fraction, labelPosition: bestPair.a.position,
    });
    placed.set(dirtyId, {
      labelFraction: bestPair.b.fraction, labelPosition: bestPair.b.position,
    });
    placementDebug[blocker.ownerId] = {
      cardCollision: 0, labelCollision: bestPair.overlap, fraction: bestPair.a.fraction,
    };
    placementDebug[dirtyId] = {
      cardCollision: 0, labelCollision: bestPair.overlap, fraction: bestPair.b.fraction,
    };
  });

  // Phase 3 — assemble routes; aws step-marker edges get their decoupled chip.
  slice.edges.forEach((edge) => {
    const route = preliminary.get(edge.id);
    if (!route) return;
    const placement = placed.get(edge.id);
    const labelFraction = placement?.labelFraction ?? 0.5;
    const resolvedLabelPosition = placement?.labelPosition
      ?? pointAlongSmoothStepPath(route.path, labelFraction, route.midpoint);
    let labelChipPosition: Point | undefined;
    if (edge.dialect === 'aws' && edge.labelOffsetY > 0 && edge.label) {
      // The rect reserved for this edge earlier was a PHANTOM: phases 1 and 2
      // choose where the numbered circle goes and assume the chip hangs
      // STEP_CHIP_DROP under it, but the chip is re-sited here. Drop the
      // phantom before searching and replace it with the real one — leaving
      // both in the list double-books the corridor and forces the next chip
      // into a least-bad overlap.
      const phantom = placedLabels.findIndex((entry) => entry.ownerId === edge.id);
      if (phantom > -1) placedLabels.splice(phantom, 1);
      const chip = placeAwsChip(
        resolvedLabelPosition,
        edge.label,
        cardRects,
        placedLabels.map((entry) => entry.rect),
        edge.controls,
        markerRects(edge.id),
        edge.labelScale,
      );
      labelChipPosition = chip.position;
      placedLabels.push({ ownerId: edge.id, rect: inflateRect(chip.rect, 4) });
    }
    routes.set(edge.id, {
      path: route.path,
      points: route.points,
      anchors: route.anchors,
      labelFraction,
      labelPosition: resolvedLabelPosition,
      labelChipPosition,
    });
  });
  return routes;
}

function rectsEqual(a: Rect | undefined, b: Rect | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y
    && a.width === b.width && a.height === b.height;
}

/**
 * LIGHT mode, used while a drag is in flight: reuse the last full result for
 * every edge whose endpoints have not moved, and give moved edges a cheap
 * un-routed path (plain smoothstep / manual-waypoint polyline) with the label
 * riding at its last placed fraction. No A*, no obstacle grids, no label
 * search — the full pass runs once, on drag end. Measured motive: the full
 * pass cost 971ms per frame on the 122-node diagram, turning drags into a
 * multi-second catch-up.
 */
function computeLightRoutes(
  slice: RouteStoreSlice,
  lastFull: {
    routes: ReadonlyMap<string, EdgeRoute>;
    rects: Map<string, Rect>;
    edgeInputs: Map<string, { waypoints?: Point[]; labelFraction?: number }>;
  },
): ReadonlyMap<string, EdgeRoute> {
  const rectsById = new Map(slice.nodes.map((node) => [node.id, node.rect]));
  const routes = new Map<string, EdgeRoute>();
  slice.edges.forEach((edge) => {
    const previous = lastFull.routes.get(edge.id);
    const sourceRect = rectsById.get(edge.source);
    const targetRect = rectsById.get(edge.target);
    if (!sourceRect || !targetRect) return;
    const cachedInputs = lastFull.edgeInputs.get(edge.id);
    // Waypoint/label drags change EDGE inputs, not node rects — without this
    // check light mode reuses the cached route and the dragged handle
    // freezes until drop.
    const moved = !rectsEqual(sourceRect, lastFull.rects.get(edge.source))
      || !rectsEqual(targetRect, lastFull.rects.get(edge.target))
      || !pointsEqual(edge.waypoints, cachedInputs?.waypoints)
      || edge.labelFraction !== cachedInputs?.labelFraction;
    if (previous && !moved) {
      routes.set(edge.id, previous);
      return;
    }
    // Label-only drag: geometry is unchanged — keep the cached (possibly
    // A*-routed) path and slide the label along it, instead of downgrading
    // the path to a plain smoothstep for the duration of the drag.
    const geometryUnchanged = previous
      && rectsEqual(sourceRect, lastFull.rects.get(edge.source))
      && rectsEqual(targetRect, lastFull.rects.get(edge.target))
      && pointsEqual(edge.waypoints, cachedInputs?.waypoints);
    if (previous && geometryUnchanged) {
      const labelFraction = edge.labelFraction
        ?? edge.positionFraction
        ?? previous.labelFraction;
      const labelPosition = pointAlongSmoothStepPath(
        previous.path,
        labelFraction,
        previous.labelPosition,
      );
      routes.set(edge.id, {
        ...previous,
        labelFraction,
        labelPosition,
        labelChipPosition: edge.dialect === 'aws' && edge.labelOffsetY > 0
          ? { x: labelPosition.x, y: labelPosition.y + STEP_CHIP_DROP }
          : previous.labelChipPosition,
      });
      return;
    }
    let path: string;
    let points: Point[];
    let anchors: EdgeAnchors;
    let midpoint: Point;
    if (edge.dialect === 'aws') {
      const sourceSide = edge.sourceSide ?? 'right';
      const targetSide = edge.targetSide ?? 'left';
      const sourceAnchor = sideMidpoint(sourceRect, sourceSide);
      const targetAnchor = sideMidpoint(targetRect, targetSide);
      anchors = {
        source: sourceAnchor,
        target: targetAnchor,
        sourceStub: sourceAnchor,
        targetStub: targetAnchor,
        sourceSide,
        targetSide,
      };
      const [awsPath, labelX, labelY] = getSmoothStepPath({
        sourceX: sourceAnchor.x,
        sourceY: sourceAnchor.y,
        targetX: targetAnchor.x,
        targetY: targetAnchor.y,
        sourcePosition: positionForSide(sourceSide),
        targetPosition: positionForSide(targetSide),
        borderRadius: 8,
        offset: 20,
      });
      path = awsPath;
      points = orthogonalVerticesFromPath(awsPath, sourceAnchor);
      midpoint = { x: labelX, y: labelY };
    } else {
      anchors = edgeAnchors(sourceRect, targetRect);
      if (edge.waypoints && edge.waypoints.length > 0) {
        const routePoints = orthogonaliseManualRoute(anchors, edge.waypoints);
        path = roundedOrthogonalPath(routePoints, 12);
        points = routePoints;
        midpoint = pointAlongSmoothStepPath(path, 0.5, anchors.source);
      } else {
        const direct = simplePath(anchors);
        path = direct.path;
        points = direct.points;
        midpoint = direct.midpoint;
      }
    }
    const labelFraction = edge.labelFraction
      ?? edge.positionFraction
      ?? previous?.labelFraction
      ?? 0.5;
    const labelPosition = pointAlongSmoothStepPath(path, labelFraction, midpoint);
    routes.set(edge.id, {
      path,
      points,
      anchors,
      labelFraction,
      labelPosition,
      labelChipPosition: edge.dialect === 'aws' && edge.labelOffsetY > 0
        ? { x: labelPosition.x, y: labelPosition.y + STEP_CHIP_DROP }
        : undefined,
    });
  });
  return routes;
}

/** Compute-cost stats — a tuning surface for the perf probe workflow. */
const routeStats = {
  computeCount: 0, totalMs: 0, lastMs: 0, lightCount: 0, lightTotalMs: 0,
};
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__edgeRouteStats = routeStats;
}

export function EdgeRoutesProvider({ children }: { children: ReactNode }) {
  const routeInputs = useStore(selectRouteInputs, routeInputsEqual);
  const lastFullRef = useRef<{
    routes: ReadonlyMap<string, EdgeRoute>;
    rects: Map<string, Rect>;
    edgeInputs: Map<string, { waypoints?: Point[]; labelFraction?: number }>;
  } | null>(null);
  const routes = useMemo(() => {
    const started = performance.now();
    if (routeInputs.dragging && lastFullRef.current) {
      const light = computeLightRoutes(routeInputs, lastFullRef.current);
      routeStats.lightTotalMs += performance.now() - started;
      routeStats.lightCount += 1;
      return light;
    }
    const result = computeRoutes(routeInputs);
    lastFullRef.current = {
      routes: result,
      rects: new Map(routeInputs.nodes.map((node) => [node.id, node.rect])),
      edgeInputs: new Map(routeInputs.edges.map((edge) => [edge.id, {
        waypoints: edge.waypoints,
        labelFraction: edge.labelFraction,
      }])),
    };
    routeStats.lastMs = performance.now() - started;
    routeStats.totalMs += routeStats.lastMs;
    routeStats.computeCount += 1;
    return result;
  }, [routeInputs]);

  // DEV-only structural check for the rule the whole layout doctrine rests on:
  // new chrome must join the placer's obstacle model in the same change that
  // renders it. Every annotation painted on a card must sit INSIDE some rect
  // the placer scores; one that hangs outside is chrome the placer is blind
  // to, which is the defect class that costs the most to chase later. Edge
  // annotations are excluded — their rect IS the label rect the placer sites.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const frame = requestAnimationFrame(() => {
      const flow = document.querySelector('.react-flow__viewport') as HTMLElement | null;
      if (!flow) return;
      const scale = flow.getBoundingClientRect().width / (flow.offsetWidth || 1);
      if (!Number.isFinite(scale) || scale <= 0) return;
      const origin = flow.getBoundingClientRect();
      const toFlow = (box: DOMRect) => ({
        x: (box.left - origin.left) / scale,
        y: (box.top - origin.top) / scale,
        width: box.width / scale,
        height: box.height / scale,
      });
      const obstacles = [
        ...routeInputs.nodes.map((node) => node.rect),
        ...routeInputs.nodes.flatMap((node) => (node.noteRect ? [node.noteRect] : [])),
        ...routeInputs.headerBands,
      ];
      const inside = (rect: Rect) => obstacles.some((obstacle) => (
        rect.x >= obstacle.x - 2 && rect.y >= obstacle.y - 2
        && rect.x + rect.width <= obstacle.x + obstacle.width + 2
        && rect.y + rect.height <= obstacle.y + obstacle.height + 2
      ));
      const unregistered: string[] = [];
      document.querySelectorAll('.dg-control-chips, .dg-owner-chip, .dg-owner-tag, .dg-status-chip')
        .forEach((element) => {
          if (element.closest('.react-flow__edgelabel-renderer')) return;
          const rect = toFlow(element.getBoundingClientRect());
          if (rect.width === 0 || rect.height === 0) return;
          if (!inside(rect)) {
            unregistered.push(`${element.className} on ${element.closest('.react-flow__node')?.getAttribute('data-id') ?? '?'}`);
          }
        });
      if (unregistered.length > 0) {
        console.warn(`[arc-diagram] ${unregistered.length} annotation(s) render outside every placer obstacle — the placer cannot see them and will site labels on top:\n  ${unregistered.join('\n  ')}`);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [routes, routeInputs]);

  return (
    <EdgeRoutesContext.Provider value={routes}>
      {children}
    </EdgeRoutesContext.Provider>
  );
}

export function useEdgeRoute(edgeId: string): EdgeRoute | undefined {
  return useContext(EdgeRoutesContext).get(edgeId);
}
