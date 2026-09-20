import { EMPTY_OVERRIDES, type EdgeLayoutEdit, type LayoutOverrides, type NodeStyleEdit } from './buildGraph';

/**
 * Global interface preferences — NOT per diagram. Where the inspector lives,
 * how wide it is, and which canvas tools are on are properties of how you
 * work, not of the diagram you happen to be looking at.
 */
export interface UiPrefs {
  sidecar: SidecarMode;
  /** Where a hidden inspector reopens. Remembered, not derived: deriving it
   *  from the current value meant a hidden inspector always resolved to
   *  'right', so docking it left and toggling twice moved it (cross-vendor
   *  review, 2026-09-15). */
  lastDocked: Exclude<SidecarMode, 'hidden'>;
  /** Width of the right-hand inspector column, px. Clamped on read. */
  sideWidth: number;
  tools: ToolPrefs;
}

export type SidecarMode = 'hidden' | 'right' | 'left';

export interface ToolPrefs {
  /** Master switch: off hides every canvas tool regardless of the rest. */
  master: boolean;
  zoom: boolean;
  lock: boolean;
  minimap: boolean;
  readout: boolean;
}

export interface PersistState {
  spacing: Record<string, number>;
  /** Global text-size multiplier, per diagram. */
  textScale: Record<string, number>;
  overrides: Record<string, LayoutOverrides>;
  /** Per-diagram, per-node style overrides. */
  styles: Record<string, Record<string, NodeStyleEdit>>;
  edges: Record<string, Record<string, EdgeLayoutEdit>>;
  ui: UiPrefs;
}

export const PERSIST_KEY = 'arc-edit-v3';
/** Read-only fallbacks, so layout edits made before this version survive. */
export const LEGACY_PERSIST_KEYS = ['arc-edit-v2', 'arc-edit-v1'];

export const SIDE_WIDTH_DEFAULT = 340;
export const SIDE_WIDTH_MIN = 260;
export const SIDE_WIDTH_MAX = 640;

export const SPACING_MIN = 0.6;
export const SPACING_MAX = 2.5;

export const TEXT_SCALE_MIN = 0.7;
export const TEXT_SCALE_MAX = 2;
export const TEXT_SCALE_STEP = 0.1;

export const DEFAULT_TOOL_PREFS: ToolPrefs = {
  master: true,
  zoom: true,
  lock: true,
  minimap: true,
  readout: true,
};

export const DEFAULT_UI_PREFS: UiPrefs = {
  sidecar: 'hidden',
  lastDocked: 'right',
  sideWidth: SIDE_WIDTH_DEFAULT,
  tools: DEFAULT_TOOL_PREFS,
};

export const EMPTY_EDGE_EDITS: Record<string, EdgeLayoutEdit> = {};
export const EMPTY_NODE_STYLES: Record<string, NodeStyleEdit> = {};

export function emptyPersistState(): PersistState {
  return {
    spacing: {},
    textScale: {},
    overrides: {},
    styles: {},
    edges: {},
    ui: { ...DEFAULT_UI_PREFS, tools: { ...DEFAULT_TOOL_PREFS } },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Colours are VALIDATED, never passed through. This blob is baked into the
 * downloadable self-contained HTML and read back as an inline style on load,
 * so an unchecked string here is an injection surface in a file a colleague
 * may open from an email.
 */
// 3, 4, 6 or 8 digits. The lazy {3,8} also accepted 5- and 7-digit strings,
// which are not valid CSS colours: the browser drops them and the override
// silently does nothing (cross-vendor review, 2026-09-15).
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim());
}

function normaliseColor(value: unknown): string | undefined {
  return isValidColor(value) ? value.trim() : undefined;
}

function normaliseTextScale(value: unknown): number | undefined {
  return isFiniteNumber(value)
    ? clampNumber(value, TEXT_SCALE_MIN, TEXT_SCALE_MAX)
    : undefined;
}

function normalisePointRecord(value: unknown): Record<string, { x: number; y: number }> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, candidate]) => (
    isRecord(candidate) && isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y)
      ? [[id, { x: candidate.x, y: candidate.y }]]
      : []
  )));
}

function normaliseToolPrefs(value: unknown): ToolPrefs {
  if (!isRecord(value)) return { ...DEFAULT_TOOL_PREFS };
  const read = (key: keyof ToolPrefs) => (
    typeof value[key] === 'boolean' ? value[key] as boolean : DEFAULT_TOOL_PREFS[key]
  );
  return {
    master: read('master'),
    zoom: read('zoom'),
    lock: read('lock'),
    minimap: read('minimap'),
    readout: read('readout'),
  };
}

function normaliseUiPrefs(value: unknown): UiPrefs {
  if (!isRecord(value)) return { ...DEFAULT_UI_PREFS, tools: { ...DEFAULT_TOOL_PREFS } };
  const sidecar = value.sidecar === 'right' || value.sidecar === 'left' || value.sidecar === 'hidden'
    ? value.sidecar
    : DEFAULT_UI_PREFS.sidecar;
  return {
    sidecar,
    lastDocked: value.lastDocked === 'left' ? 'left'
      : sidecar === 'left' ? 'left' : 'right',
    sideWidth: isFiniteNumber(value.sideWidth)
      ? clampNumber(value.sideWidth, SIDE_WIDTH_MIN, SIDE_WIDTH_MAX)
      : SIDE_WIDTH_DEFAULT,
    tools: normaliseToolPrefs(value.tools),
  };
}

function normaliseNodeStyles(value: unknown): Record<string, Record<string, NodeStyleEdit>> {
  const styles: Record<string, Record<string, NodeStyleEdit>> = {};
  if (!isRecord(value)) return styles;
  Object.entries(value).forEach(([diagramId, diagramValue]) => {
    if (!isRecord(diagramValue)) return;
    const diagramStyles: Record<string, NodeStyleEdit> = {};
    Object.entries(diagramValue).forEach(([nodeId, candidate]) => {
      if (!isRecord(candidate)) return;
      const edit: NodeStyleEdit = {
        textScale: normaliseTextScale(candidate.textScale),
        ink: normaliseColor(candidate.ink),
        border: normaliseColor(candidate.border),
      };
      if (edit.textScale !== undefined || edit.ink || edit.border) diagramStyles[nodeId] = edit;
    });
    if (Object.keys(diagramStyles).length > 0) styles[diagramId] = diagramStyles;
  });
  return styles;
}

export function normalisePersistState(value: unknown): PersistState {
  if (!isRecord(value)) return emptyPersistState();
  // Clamped on READ to the same bounds the stepper enforces on write. A
  // hand-edited or older blob carrying spacing: -1 or 1e9 was previously
  // accepted whole and produced negative or astronomical gaps (cross-vendor
  // review, 2026-09-15).
  const spacing = isRecord(value.spacing)
    ? Object.fromEntries(Object.entries(value.spacing).flatMap(([id, candidate]) => (
      isFiniteNumber(candidate)
        ? [[id, clampNumber(candidate, SPACING_MIN, SPACING_MAX)] as const]
        : []
    )))
    : {};
  const textScale = isRecord(value.textScale)
    ? Object.fromEntries(Object.entries(value.textScale).flatMap(([id, candidate]) => {
      const scale = normaliseTextScale(candidate);
      return scale === undefined ? [] : [[id, scale] as const];
    }))
    : {};
  const overrides: Record<string, LayoutOverrides> = {};
  if (isRecord(value.overrides)) {
    Object.entries(value.overrides).forEach(([diagramId, candidate]) => {
      if (!isRecord(candidate)) return;
      const size = isRecord(candidate.size)
        ? Object.fromEntries(Object.entries(candidate.size).flatMap(([id, dimensions]) => (
          isRecord(dimensions)
            && isFiniteNumber(dimensions.width)
            && isFiniteNumber(dimensions.height)
            && dimensions.width > 0
            && dimensions.height > 0
            ? [[id, { width: dimensions.width, height: dimensions.height }]]
            : []
        )))
        : {};
      overrides[diagramId] = { pos: normalisePointRecord(candidate.pos), size };
    });
  }
  const edges: PersistState['edges'] = {};
  if (isRecord(value.edges)) {
    Object.entries(value.edges).forEach(([diagramId, diagramValue]) => {
      if (!isRecord(diagramValue)) return;
      const diagramEdges: Record<string, EdgeLayoutEdit> = {};
      Object.entries(diagramValue).forEach(([edgeId, candidate]) => {
        if (!isRecord(candidate)) return;
        const waypoints = Array.isArray(candidate.waypoints)
          ? candidate.waypoints.flatMap((waypoint) => (
            isRecord(waypoint) && isFiniteNumber(waypoint.x) && isFiniteNumber(waypoint.y)
              ? [{ x: waypoint.x, y: waypoint.y }]
              : []
          ))
          : [];
        const labelFraction = isFiniteNumber(candidate.labelFraction)
          ? clampNumber(candidate.labelFraction, 0.05, 0.95)
          : undefined;
        const labelScale = normaliseTextScale(candidate.labelScale);
        const color = normaliseColor(candidate.color);
        if (waypoints.length > 0 || labelFraction !== undefined
          || labelScale !== undefined || color) {
          diagramEdges[edgeId] = {
            waypoints: waypoints.length > 0 ? waypoints : undefined,
            labelFraction,
            labelScale,
            color,
          };
        }
      });
      if (Object.keys(diagramEdges).length > 0) edges[diagramId] = diagramEdges;
    });
  }
  return {
    spacing,
    textScale,
    overrides,
    styles: normaliseNodeStyles(value.styles),
    edges,
    ui: normaliseUiPrefs(value.ui),
  };
}

export function loadPersistState(): PersistState {
  if (window.__ARC_STATE__ && typeof window.__ARC_STATE__ === 'object') {
    return normalisePersistState(window.__ARC_STATE__);
  }
  try {
    const raw = [PERSIST_KEY, ...LEGACY_PERSIST_KEYS]
      .map((key) => window.localStorage.getItem(key))
      .find((candidate) => candidate);
    if (raw) return normalisePersistState(JSON.parse(raw));
  } catch {
    // Fall through to the pristine state.
  }
  return emptyPersistState();
}

export { EMPTY_OVERRIDES };
