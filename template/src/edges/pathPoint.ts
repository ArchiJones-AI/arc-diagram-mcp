export interface Point {
  x: number;
  y: number;
}

const PATH_TOKEN = /[MLQ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const CURVE_STEPS = 24;

function point(x: string, y: string): Point {
  return { x: Number(x), y: Number(y) };
}

/** Samples the M/L/Q command set emitted by getSmoothStepPath and the router. */
export function sampledPathPoints(path: string, fallback: Point): Point[] {
  const tokens = path.match(PATH_TOKEN);
  if (!tokens) return [fallback];

  const points: Point[] = [];
  let cursor = 0;
  let current = fallback;

  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === 'M' || command === 'L') {
      if (cursor + 1 >= tokens.length) return [fallback];
      current = point(tokens[cursor++], tokens[cursor++]);
      points.push(current);
      continue;
    }

    if (command === 'Q') {
      if (cursor + 3 >= tokens.length) return [fallback];
      const start = current;
      const control = point(tokens[cursor++], tokens[cursor++]);
      const end = point(tokens[cursor++], tokens[cursor++]);

      for (let step = 1; step <= CURVE_STEPS; step += 1) {
        const t = step / CURVE_STEPS;
        const inverse = 1 - t;
        points.push({
          x: inverse * inverse * start.x
            + 2 * inverse * t * control.x
            + t * t * end.x,
          y: inverse * inverse * start.y
            + 2 * inverse * t * control.y
            + t * t * end.y,
        });
      }
      current = end;
      continue;
    }

    return [fallback];
  }

  return points.length > 0 ? points : [fallback];
}

/** Recovers the square-corner polyline represented by an M/L/Q rounded path. */
export function orthogonalVerticesFromPath(path: string, fallback: Point): Point[] {
  const tokens = path.match(PATH_TOKEN);
  if (!tokens) return [fallback];
  const vertices: Point[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === 'M' || command === 'L') {
      if (cursor + 1 >= tokens.length) return [fallback];
      vertices.push(point(tokens[cursor++], tokens[cursor++]));
    } else if (command === 'Q') {
      if (cursor + 3 >= tokens.length) return [fallback];
      vertices.push(point(tokens[cursor++], tokens[cursor++]));
      vertices.push(point(tokens[cursor++], tokens[cursor++]));
    } else {
      return [fallback];
    }
  }
  const deduplicated = vertices.filter((vertex, index) => (
    index === 0
    || Math.abs(vertex.x - vertices[index - 1].x) > 0.001
    || Math.abs(vertex.y - vertices[index - 1].y) > 0.001
  ));
  return deduplicated.filter((vertex, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true;
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    return !(
      (Math.abs(previous.x - vertex.x) < 0.001 && Math.abs(vertex.x - next.x) < 0.001)
      || (Math.abs(previous.y - vertex.y) < 0.001 && Math.abs(vertex.y - next.y) < 0.001)
    );
  });
}

function cumulativeLengths(points: Point[]): number[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    ));
  }
  return lengths;
}

export function pointAlongPolyline(
  points: Point[],
  fraction: number,
  fallback: Point,
): Point {
  if (points.length < 2) return fallback;

  const lengths = cumulativeLengths(points);

  const totalLength = lengths[lengths.length - 1];
  if (totalLength === 0) return fallback;

  const targetLength = Math.min(1, Math.max(0, fraction)) * totalLength;
  let index = 1;
  while (index < lengths.length - 1 && lengths[index] < targetLength) index += 1;

  const segmentLength = lengths[index] - lengths[index - 1];
  const segmentProgress = segmentLength === 0
    ? 0
    : (targetLength - lengths[index - 1]) / segmentLength;

  return {
    x: points[index - 1].x
      + (points[index].x - points[index - 1].x) * segmentProgress,
    y: points[index - 1].y
      + (points[index].y - points[index - 1].y) * segmentProgress,
  };
}

export function pointAlongSmoothStepPath(
  path: string,
  fraction: number,
  fallback: Point,
): Point {
  return pointAlongPolyline(sampledPathPoints(path, fallback), fraction, fallback);
}

export function roundedOrthogonalPath(points: Point[], radius = 12): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  let path = `M${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incomingLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    if (cornerRadius <= 0) {
      path += ` L${corner.x} ${corner.y}`;
      continue;
    }
    const before = {
      x: corner.x - ((corner.x - previous.x) / incomingLength) * cornerRadius,
      y: corner.y - ((corner.y - previous.y) / incomingLength) * cornerRadius,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoingLength) * cornerRadius,
      y: corner.y + ((next.y - corner.y) / outgoingLength) * cornerRadius,
    };
    path += ` L${before.x} ${before.y} Q${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const end = points[points.length - 1];
  return `${path} L${end.x} ${end.y}`;
}

export interface PathProjection extends Point {
  fraction: number;
  distance: number;
}

export function projectPointOntoPolyline(points: Point[], point: Point): PathProjection {
  if (points.length < 2) return { ...point, fraction: 0.5, distance: 0 };
  const lengths = cumulativeLengths(points);
  const totalLength = lengths[lengths.length - 1];
  let best: PathProjection = { ...points[0], fraction: 0, distance: Number.POSITIVE_INFINITY };

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ));
    const projected = { x: start.x + dx * progress, y: start.y + dy * progress };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance < best.distance) {
      const segmentLength = Math.sqrt(lengthSquared);
      best = {
        ...projected,
        fraction: totalLength === 0
          ? 0.5
          : (lengths[index - 1] + segmentLength * progress) / totalLength,
        distance,
      };
    }
  }
  return best;
}
