export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutingObstacle extends Rect {
  id: string;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface EdgeAnchors {
  source: Point;
  target: Point;
  sourceStub: Point;
  targetStub: Point;
  sourceSide: Side;
  targetSide: Side;
}

interface GraphNode extends Point {
  neighbours: GraphLink[];
}

interface GraphLink {
  node: number;
  length: number;
  direction: Direction;
  huggingCost: number;
}

type Direction = 'none' | 'horizontal' | 'vertical';

interface SearchState {
  stateKey: string;
  node: number;
  direction: Direction;
  cost: number;
  bends: number;
  estimate: number;
  serial: number;
}

const EPSILON = 0.001;
const ANCHOR_CLEARANCE = 14;
const BEND_PENALTY = 36;
const HUGGING_BASE_PENALTY = 3;
const DIRECTION_ORDER: Record<Direction, number> = {
  none: 0,
  horizontal: 1,
  vertical: 2,
};

function centre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function sideToward(rect: Rect, toward: Point): Side {
  const origin = centre(rect);
  const normalisedX = (toward.x - origin.x) / Math.max(rect.width / 2, EPSILON);
  const normalisedY = (toward.y - origin.y) / Math.max(rect.height / 2, EPSILON);
  if (Math.abs(normalisedX) >= Math.abs(normalisedY)) {
    return normalisedX >= 0 ? 'right' : 'left';
  }
  return normalisedY >= 0 ? 'bottom' : 'top';
}

function anchorForSide(rect: Rect, side: Side): Point {
  if (side === 'left') return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === 'right') return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === 'top') return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function offsetFromSide(point: Point, side: Side, distance: number): Point {
  if (side === 'left') return { x: point.x - distance, y: point.y };
  if (side === 'right') return { x: point.x + distance, y: point.y };
  if (side === 'top') return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

export function edgeAnchors(sourceRect: Rect, targetRect: Rect): EdgeAnchors {
  const sourceSide = sideToward(sourceRect, centre(targetRect));
  const targetSide = sideToward(targetRect, centre(sourceRect));
  const source = anchorForSide(sourceRect, sourceSide);
  const target = anchorForSide(targetRect, targetSide);
  return {
    source,
    target,
    sourceStub: offsetFromSide(source, sourceSide, ANCHOR_CLEARANCE),
    targetStub: offsetFromSide(target, targetSide, ANCHOR_CLEARANCE),
    sourceSide,
    targetSide,
  };
}

export function inflateRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

function pointInsideObstacle(point: Point, obstacle: Rect): boolean {
  return point.x > obstacle.x + EPSILON
    && point.x < rectRight(obstacle) - EPSILON
    && point.y > obstacle.y + EPSILON
    && point.y < rectBottom(obstacle) - EPSILON;
}

function rangesOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  return Math.min(a2, b2) - Math.max(a1, b1) > EPSILON;
}

export function segmentCrossesRect(start: Point, end: Point, rect: Rect): boolean {
  if (Math.abs(start.y - end.y) < EPSILON) {
    return start.y > rect.y + EPSILON
      && start.y < rectBottom(rect) - EPSILON
      && rangesOverlap(
        Math.min(start.x, end.x),
        Math.max(start.x, end.x),
        rect.x,
        rectRight(rect),
      );
  }
  if (Math.abs(start.x - end.x) < EPSILON) {
    return start.x > rect.x + EPSILON
      && start.x < rectRight(rect) - EPSILON
      && rangesOverlap(
        Math.min(start.y, end.y),
        Math.max(start.y, end.y),
        rect.y,
        rectBottom(rect),
      );
  }
  return false;
}

function segmentClear(start: Point, end: Point, obstacles: RoutingObstacle[]): boolean {
  return !obstacles.some((obstacle) => segmentCrossesRect(start, end, obstacle));
}

function huggingCost(start: Point, end: Point, obstacles: RoutingObstacle[]): number {
  let cost = 0;
  obstacles.forEach((obstacle) => {
    const right = rectRight(obstacle);
    const bottom = rectBottom(obstacle);
    if (Math.abs(start.y - end.y) < EPSILON) {
      const onBoundary = Math.abs(start.y - obstacle.y) < EPSILON
        || Math.abs(start.y - bottom) < EPSILON;
      if (onBoundary && rangesOverlap(
        Math.min(start.x, end.x),
        Math.max(start.x, end.x),
        obstacle.x,
        right,
      )) cost += HUGGING_BASE_PENALTY + Math.abs(end.x - start.x) * 0.015;
    } else if (Math.abs(start.x - end.x) < EPSILON) {
      const onBoundary = Math.abs(start.x - obstacle.x) < EPSILON
        || Math.abs(start.x - right) < EPSILON;
      if (onBoundary && rangesOverlap(
        Math.min(start.y, end.y),
        Math.max(start.y, end.y),
        obstacle.y,
        bottom,
      )) cost += HUGGING_BASE_PENALTY + Math.abs(end.y - start.y) * 0.015;
    }
  });
  return cost;
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, index) => (
    index === 0 || Math.abs(value - sorted[index - 1]) >= EPSILON
  ));
}

function pointKey(point: Point): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
}

function addLink(
  nodes: GraphNode[],
  from: number,
  to: number,
  direction: Direction,
  obstacles: RoutingObstacle[],
): void {
  const start = nodes[from];
  const end = nodes[to];
  if (!segmentClear(start, end, obstacles)) return;
  const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  const boundaryCost = huggingCost(start, end, obstacles);
  nodes[from].neighbours.push({ node: to, length, direction, huggingCost: boundaryCost });
  nodes[to].neighbours.push({ node: from, length, direction, huggingCost: boundaryCost });
}

function buildRoutingGraph(
  anchors: EdgeAnchors,
  obstacles: RoutingObstacle[],
): { nodes: GraphNode[]; indexByPoint: Map<string, number> } {
  const xs = uniqueSorted([
    anchors.source.x,
    anchors.sourceStub.x,
    anchors.target.x,
    anchors.targetStub.x,
    ...obstacles.flatMap((obstacle) => [obstacle.x, rectRight(obstacle)]),
  ]);
  const ys = uniqueSorted([
    anchors.source.y,
    anchors.sourceStub.y,
    anchors.target.y,
    anchors.targetStub.y,
    ...obstacles.flatMap((obstacle) => [obstacle.y, rectBottom(obstacle)]),
  ]);
  const nodes: GraphNode[] = [];
  const indexByPoint = new Map<string, number>();

  ys.forEach((y) => {
    xs.forEach((x) => {
      const candidate = { x, y };
      if (obstacles.some((obstacle) => pointInsideObstacle(candidate, obstacle))) return;
      indexByPoint.set(pointKey(candidate), nodes.length);
      nodes.push({ ...candidate, neighbours: [] });
    });
  });

  ys.forEach((y) => {
    let previous: number | undefined;
    xs.forEach((x) => {
      const current = indexByPoint.get(pointKey({ x, y }));
      if (current === undefined) return;
      if (previous !== undefined) addLink(nodes, previous, current, 'horizontal', obstacles);
      previous = current;
    });
  });
  xs.forEach((x) => {
    let previous: number | undefined;
    ys.forEach((y) => {
      const current = indexByPoint.get(pointKey({ x, y }));
      if (current === undefined) return;
      if (previous !== undefined) addLink(nodes, previous, current, 'vertical', obstacles);
      previous = current;
    });
  });

  nodes.forEach((node) => {
    node.neighbours.sort((a, b) => a.node - b.node);
  });
  return { nodes, indexByPoint };
}

function compareSearchState(a: SearchState, b: SearchState): number {
  return a.estimate - b.estimate
    || a.cost - b.cost
    || a.bends - b.bends
    || a.node - b.node
    || DIRECTION_ORDER[a.direction] - DIRECTION_ORDER[b.direction]
    || a.serial - b.serial;
}

class MinHeap {
  private values: SearchState[] = [];

  get length(): number {
    return this.values.length;
  }

  push(value: SearchState): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareSearchState(this.values[parent], value) <= 0) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): SearchState | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length
        && compareSearchState(this.values[right], this.values[left]) < 0
        ? right
        : left;
      if (compareSearchState(last, this.values[child]) <= 0) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function searchGraph(
  graph: ReturnType<typeof buildRoutingGraph>,
  startPoint: Point,
  endPoint: Point,
): Point[] | null {
  const start = graph.indexByPoint.get(pointKey(startPoint));
  const target = graph.indexByPoint.get(pointKey(endPoint));
  if (start === undefined || target === undefined) return null;

  const queue = new MinHeap();
  const best = new Map<string, number>();
  const parents = new Map<string, string>();
  let serial = 0;
  const initialKey = `${start}:none`;
  queue.push({
    stateKey: initialKey,
    node: start,
    direction: 'none',
    cost: 0,
    bends: 0,
    estimate: Math.abs(startPoint.x - endPoint.x) + Math.abs(startPoint.y - endPoint.y),
    serial: serial++,
  });
  best.set(initialKey, 0);

  let finalState: SearchState | undefined;
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current.cost > (best.get(current.stateKey) ?? Number.POSITIVE_INFINITY) + EPSILON) continue;
    if (current.node === target) {
      finalState = current;
      break;
    }

    graph.nodes[current.node].neighbours.forEach((link) => {
      const bends = current.bends + (
        current.direction !== 'none' && current.direction !== link.direction ? 1 : 0
      );
      const cost = current.cost
        + link.length
        + link.huggingCost
        + (bends - current.bends) * BEND_PENALTY;
      const stateKey = `${link.node}:${link.direction}`;
      const previousBest = best.get(stateKey);
      if (previousBest !== undefined && previousBest <= cost + EPSILON) return;
      best.set(stateKey, cost);
      parents.set(stateKey, current.stateKey);
      const node = graph.nodes[link.node];
      queue.push({
        stateKey,
        node: link.node,
        direction: link.direction,
        cost,
        bends,
        estimate: cost + Math.abs(node.x - endPoint.x) + Math.abs(node.y - endPoint.y),
        serial: serial++,
      });
    });
  }

  if (!finalState) return null;
  const nodeIndexes: number[] = [];
  let cursor: string | undefined = finalState.stateKey;
  while (cursor) {
    nodeIndexes.push(Number(cursor.slice(0, cursor.indexOf(':'))));
    cursor = parents.get(cursor);
  }
  nodeIndexes.reverse();
  return nodeIndexes.map((index) => ({ x: graph.nodes[index].x, y: graph.nodes[index].y }));
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

export function simplifyOrthogonalPoints(points: Point[]): Point[] {
  const deduplicated = points.filter((point, index) => (
    index === 0 || !samePoint(point, points[index - 1])
  ));
  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true;
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    const vertical = Math.abs(previous.x - point.x) < EPSILON
      && Math.abs(point.x - next.x) < EPSILON;
    const horizontal = Math.abs(previous.y - point.y) < EPSILON
      && Math.abs(point.y - next.y) < EPSILON;
    return !vertical && !horizontal;
  });
}

/**
 * A stub 14px out from a card can land INSIDE a neighbouring card's inflated
 * obstacle when a family packs at 24-30px gaps — the grid drops that point,
 * the search has no start, and the edge silently falls back to a straight
 * path through cards (probe-caught on the template exemplar's e-feedback).
 * Clamp the stub back toward its anchor until it clears the obstacles.
 */
function clampedStub(anchor: Point, side: Side, obstacles: RoutingObstacle[]): Point {
  const clearances = [ANCHOR_CLEARANCE, 10, 6, 3, 1];
  for (const clearance of clearances) {
    const stub = offsetFromSide(anchor, side, clearance);
    if (!obstacles.some((obstacle) => pointInsideObstacle(stub, obstacle))) return stub;
  }
  return anchor;
}

export function routeOrthogonal(
  anchors: EdgeAnchors,
  obstacles: RoutingObstacle[],
  /** Thinner-margin obstacle set for a retry when the full margin has sealed
   *  every corridor around an anchor (still keeps paths off card bodies). */
  relaxedObstacles?: RoutingObstacle[],
): Point[] | null {
  const attempt = (set: RoutingObstacle[]): Point[] | null => {
    const adjusted: EdgeAnchors = {
      ...anchors,
      sourceStub: clampedStub(anchors.source, anchors.sourceSide, set),
      targetStub: clampedStub(anchors.target, anchors.targetSide, set),
    };
    const graph = buildRoutingGraph(adjusted, set);
    const middle = searchGraph(graph, adjusted.sourceStub, adjusted.targetStub);
    if (!middle) return null;
    return simplifyOrthogonalPoints([anchors.source, ...middle, anchors.target]);
  };
  const full = attempt(obstacles);
  if (full) return full;
  return relaxedObstacles ? attempt(relaxedObstacles) : null;
}

function appendOrthogonal(
  points: Point[],
  target: Point,
  firstDirection: Exclude<Direction, 'none'>,
): void {
  const start = points[points.length - 1];
  if (samePoint(start, target)) return;
  if (Math.abs(start.x - target.x) < EPSILON || Math.abs(start.y - target.y) < EPSILON) {
    points.push(target);
    return;
  }
  points.push(firstDirection === 'horizontal'
    ? { x: target.x, y: start.y }
    : { x: start.x, y: target.y });
  points.push(target);
}

function sideDirection(side: Side): Exclude<Direction, 'none'> {
  return side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
}

/** User-authored waypoints are authoritative; this only inserts right-angle elbows. */
export function orthogonaliseManualRoute(
  anchors: EdgeAnchors,
  waypoints: Point[],
): Point[] {
  const points = [anchors.source, anchors.sourceStub];
  waypoints.forEach((waypoint, index) => {
    const start = points[points.length - 1];
    const direction = index === 0
      ? sideDirection(anchors.sourceSide)
      : Math.abs(waypoint.x - start.x) >= Math.abs(waypoint.y - start.y)
        ? 'horizontal'
        : 'vertical';
    appendOrthogonal(points, waypoint, direction);
  });

  const current = points[points.length - 1];
  const targetDirection = sideDirection(anchors.targetSide);
  if (Math.abs(current.x - anchors.targetStub.x) >= EPSILON
    && Math.abs(current.y - anchors.targetStub.y) >= EPSILON) {
    points.push(targetDirection === 'horizontal'
      ? { x: current.x, y: anchors.targetStub.y }
      : { x: anchors.targetStub.x, y: current.y });
  }
  points.push(anchors.targetStub, anchors.target);
  return simplifyOrthogonalPoints(points);
}
