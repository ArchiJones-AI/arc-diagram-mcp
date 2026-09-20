import {
  MarkerType,
  Position,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  LC_BUS_SPLIT,
  LC_BUS_Y,
  LC_STAGE_POINT,
  LC_TAB_H,
  LC_TAB_W,
  LEGEND_NODE_ID,
  LIFECYCLE_CHROME_ID,
  PYR_HEADING_H,
  computeDiagramLayout,
  type DiagramLayout,
} from './layout';
import type {
  BlockColor,
  CsdmIcon,
  DiagramDef,
  DiagramEdgeDef,
  DiagramGroupDef,
  DiagramLegend,
  DiagramNodeDef,
  FlowStep,
  GroupKind,
} from './model';
import { partyLabel } from './model';
import type { DiagramThemePalette } from './theme';

export type InteractionState = 'rest' | 'selected' | 'neighbor' | 'active' | 'dim';

export interface DiagramNodeData extends Record<string, unknown> {
  def: DiagramNodeDef;
  groupTitle: string;
  groupColor: BlockColor;
  groupKind: GroupKind | 'canvas';
  interaction: InteractionState;
  /** Embed mode: nodes render an expandable notes affordance for `detail`. */
  embedMode: boolean;
  /** pyramid dialect: 0-based tier index (top = 0) for the color ramp. */
  pyramidRow?: number;
  /** pyramid dialect: total tier count for the color ramp. */
  pyramidRows?: number;
  /** Resolved short party name for the owner corner tag; renderers are
   *  data-in, so no party name is compiled into a component. */
  ownerLabel?: string;
  /** lifecycle dialect: depth of the chevron's right-hand point, in px. */
  lifecyclePoint?: number;
}

/** lifecycle dialect: single decoration node carrying frame, tab and title. */
export interface LifecycleChromeData extends Record<string, unknown> {
  tab?: string;
  frameTitle?: string;
  tabHeight: number;
  tabWidth: number;
}

/** pyramid dialect: single decoration node carrying heading + axis. */
export interface PyramidChromeData extends Record<string, unknown> {
  title: string;
  subtitle?: string;
  axisLabel?: string;
  /** Axis geometry, relative to the chrome node's own box. */
  axisTop: number;
  axisHeight: number;
}

export interface DiagramGroupData extends Record<string, unknown> {
  def: DiagramGroupDef;
  depth: number;
  editable: boolean;
}

export interface DiagramEdgeData extends Record<string, unknown> {
  def: DiagramEdgeDef;
  interaction: 'rest' | 'active' | 'dim';
  isIsland: boolean;
  stepActive: boolean;
  /** Authored/manual tuning override; absent floating edges are auto-placed. */
  positionFraction?: number;
  editMode: boolean;
  /** The canvas text scale, so the edge-label placer can model the chip at
   *  its RENDERED size rather than at the 1x default its constants encode. */
  textScale: number;
  edgeEdit?: EdgeLayoutEdit;
  onEdgeEdit?: (edgeId: string, edit: EdgeLayoutEdit) => void;
  /** Edit mode: a click (not a drag) on the label selects the relationship. */
  onEdgeSelect?: (edgeId: string, additive: boolean) => void;
  onStepSelect?: (stepNo: number) => void;
  /** lifecycle dialect: the shared rail y, in canvas coordinates. */
  lifecycleBusY?: number;
  /** lifecycle dialect: sideways shift of the sending / receiving ends. */
  lifecycleOutOffset?: number;
  lifecycleInOffset?: number;
}

export type DiagramLeafNode = Node<DiagramNodeData, 'diagramNode' | 'awsTile' | 'pyramidBar' | 'csdmCard' | 'lifecycleStage' | 'lifecycleBand'>;
export type DiagramGroupNode = Node<DiagramGroupData, 'diagramGroup' | 'csdmRegion'>;
export type PyramidChromeNode = Node<PyramidChromeData, 'pyramidChrome'>;
/** csdm dialect: the Manage Portfolio hub, one non-interactive chrome node. */
export type CsdmHubNode = Node<
  { title: string; icon: CsdmIcon } & Record<string, unknown>,
  'csdmHub'
>;
export type LifecycleChromeNode = Node<LifecycleChromeData, 'lifecycleChrome'>;
export type LegendChromeNode = Node<
  { legend: DiagramLegend; administrators: Record<string, string> } & Record<string, unknown>,
  'legendChrome'
>;
export type DiagramFlowNode = DiagramLeafNode | DiagramGroupNode | PyramidChromeNode
  | CsdmHubNode
  | LifecycleChromeNode | LegendChromeNode;
export type DiagramFlowEdge = Edge<DiagramEdgeData, 'floating' | 'aws' | 'lifecycleBus'>;

export interface GraphSelection {
  nodeId?: string;
  stepNo?: number;
}

/**
 * Manual edit state, applied ON TOP of the computed layout. Positions are
 * parent-relative (React Flow semantics once parentId is set); sizes apply
 * to groups resized via NodeResizer. Cleared by the Reset action.
 */
export interface LayoutOverrides {
  pos: Record<string, { x: number; y: number }>;
  size: Record<string, { width: number; height: number }>;
}

export interface EdgeLayoutEdit {
  waypoints?: { x: number; y: number }[];
  labelFraction?: number;
  /** Per-label text-size multiplier (1 = the diagram's current scale). */
  labelScale?: number;
  /** Per-edge line and arrowhead colour; any CSS colour the validator passed. */
  color?: string;
}

/** Per-node style override: text size, text colour, outline colour. */
export interface NodeStyleEdit {
  textScale?: number;
  ink?: string;
  border?: string;
}

export const EMPTY_OVERRIDES: LayoutOverrides = { pos: {}, size: {} };

export interface BuildGraphOptions {
  selection: GraphSelection;
  onStepSelect(stepNo: number): void;
  theme: DiagramThemePalette;
  /** Uniform layout-gap multiplier (1 = authored default). */
  spacing?: number;
  /** Global text-size multiplier for this diagram (1 = authored default). */
  textScale?: number;
  /** Per-node style overrides (text size, text colour, outline colour). */
  nodeStyles?: Record<string, NodeStyleEdit>;
  /** Edit mode: nodes draggable/selectable, groups resizable. */
  editMode?: boolean;
  /** Manual position/size overrides for this diagram. */
  overrides?: LayoutOverrides;
  /** Manual edge geometry/label overrides for this diagram. */
  edgeEdits?: Record<string, EdgeLayoutEdit>;
  /** Persists one floating edge edit. */
  onEdgeEdit?: (edgeId: string, edit: EdgeLayoutEdit) => void;
  /** Selects one relationship from a label click in edit mode. */
  onEdgeSelect?: (edgeId: string, additive: boolean) => void;
  /** React Flow multi-selection state (edit mode). */
  selectedIds?: ReadonlySet<string>;
  /** Embed mode (?embed=<diagramId>): nodes render the notes affordance. */
  embedMode?: boolean;
  /**
   * Opaque counter, read by nobody. Bumping it forces a fresh graph object,
   * which updates the React Flow store, which re-runs the edge-route selector.
   * That is the only way to make the routing layer re-evaluate after a change
   * that lives outside the store — see `routeEpoch` in App.tsx.
   */
  routeEpoch?: number;
}

export interface DiagramGraph {
  nodes: DiagramFlowNode[];
  edges: DiagramFlowEdge[];
  layout: DiagramLayout;
}

function groupDepth(group: DiagramGroupDef, groups: Map<string, DiagramGroupDef>): number {
  let depth = 0;
  let parent = group.parent;
  while (parent) {
    depth += 1;
    parent = groups.get(parent)?.parent;
  }
  return depth;
}

function activeStep(diagram: DiagramDef, stepNo?: number): FlowStep | undefined {
  return stepNo === undefined
    ? undefined
    : diagram.steps?.find((step) => step.n === stepNo);
}

function leafInteraction(
  nodeId: string,
  selectedNodeId: string | undefined,
  neighbours: Set<string>,
  step: FlowStep | undefined,
): InteractionState {
  if (selectedNodeId) {
    if (nodeId === selectedNodeId) return 'selected';
    return neighbours.has(nodeId) ? 'neighbor' : 'dim';
  }
  if (step) return step.nodes.includes(nodeId) ? 'active' : 'dim';
  return 'rest';
}

function edgeInteraction(
  edge: DiagramEdgeDef,
  selectedNodeId: string | undefined,
  step: FlowStep | undefined,
): 'rest' | 'active' | 'dim' {
  if (selectedNodeId) {
    return edge.from === selectedNodeId || edge.to === selectedNodeId ? 'active' : 'dim';
  }
  if (step) return step.edges.includes(edge.id) ? 'active' : 'dim';
  return 'rest';
}

type Side = 'left' | 'right' | 'top' | 'bottom';

function opposite(side: Side): Side {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'top') return 'bottom';
  return 'top';
}

function fixedHandles(edge: DiagramEdgeDef, layout: DiagramLayout): {
  sourceHandle: string;
  targetHandle: string;
} {
  const source = layout.boxes[edge.from];
  const target = layout.boxes[edge.to];
  const sourceCentre = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCentre = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  const dx = targetCentre.x - sourceCentre.x;
  const dy = targetCentre.y - sourceCentre.y;
  let sourceSide: Side;

  if (Math.abs(dx) >= Math.abs(dy)) {
    sourceSide = dx >= 0 ? 'right' : 'left';
  } else {
    sourceSide = dy >= 0 ? 'bottom' : 'top';
  }

  const targetSide = opposite(sourceSide);
  return {
    sourceHandle: `${sourceSide}-source`,
    targetHandle: `${targetSide}-target`,
  };
}

function markerColor(
  diagram: DiagramDef,
  interaction: 'rest' | 'active' | 'dim',
  theme: DiagramThemePalette,
  isIsland: boolean,
): string {
  if (isIsland) return theme.islandMarker;
  if (diagram.dialect === 'csdm') {
    return interaction === 'dim' ? theme.csdmMarkerDim : theme.csdmMarker;
  }
  if (interaction === 'dim') {
    return diagram.dialect === 'aws' ? theme.awsMarkerDim : theme.floatingMarkerDim;
  }
  if (interaction === 'active') return theme.activeMarker;
  return diagram.dialect === 'aws' ? theme.awsMarker : theme.floatingMarker;
}

/**
 * EXEMPLAR-KEYED tuning map — label/circle position (0..1) along an edge's
 * path, keyed by diagram id → EDGE id from src/data. Unknown keys use the
 * global automatic label placer: no error, no typecheck failure. When you
 * replace the data files, CLEAR this map, then re-populate during the
 * layout-tuning probe for any chip or numbered circle that collides.
 */
const EDGE_POSITION_FRACTIONS: Partial<
  Record<DiagramDef['id'], Record<string, number>>
> = {
  // BUILD-SPEC-3: the automatic label placer owns placement — add a key here
  // ONLY when a probe run shows the placer losing on a specific edge (an
  // over-constrained corridor where every candidate collides and least-bad
  // still overlaps).
};

const EMPTY_NODE_STYLES: Record<string, NodeStyleEdit> = {};

export function buildGraph(diagram: DiagramDef, options: BuildGraphOptions): DiagramGraph {
  const spacing = options.spacing ?? 1;
  const editMode = options.editMode ?? false;
  const overrides = options.overrides ?? EMPTY_OVERRIDES;
  const selectedIds = options.selectedIds;
  const textScale = options.textScale ?? 1;
  const nodeStyles = options.nodeStyles ?? EMPTY_NODE_STYLES;
  const layout = computeDiagramLayout(diagram, spacing);
  // The legend is chrome: one non-interactive node below the root grid,
  // carrying its party names already resolved.
  const legendBox = layout.boxes[LEGEND_NODE_ID];
  const legendNodes: LegendChromeNode[] = diagram.legend && legendBox ? [{
    id: LEGEND_NODE_ID,
    type: 'legendChrome',
    position: { x: legendBox.x, y: legendBox.y },
    width: legendBox.width,
    height: legendBox.height,
    zIndex: -10,
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    data: {
      legend: diagram.legend,
      administrators: {
        customer: partyLabel(diagram, 'customer', 'long'),
        supplier: partyLabel(diagram, 'supplier', 'long'),
        product: partyLabel(diagram, 'product', 'long'),
      },
    },
  }] : [];
  const groupMap = new Map(diagram.groups.map((group) => [group.id, group]));
  const step = activeStep(diagram, options.selection.stepNo);
  const neighbours = new Set<string>();

  if (options.selection.nodeId) {
    diagram.edges.forEach((edge) => {
      if (edge.from === options.selection.nodeId) neighbours.add(edge.to);
      if (edge.to === options.selection.nodeId) neighbours.add(edge.from);
    });
  }

  if (diagram.dialect === 'lifecycle') {
    const chromeBox = layout.boxes[LIFECYCLE_CHROME_ID];
    const chrome: LifecycleChromeNode = {
      id: LIFECYCLE_CHROME_ID,
      type: 'lifecycleChrome',
      position: { x: chromeBox.x, y: chromeBox.y },
      width: chromeBox.width,
      height: chromeBox.height,
      zIndex: -10,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      data: {
        tab: diagram.tab,
        frameTitle: diagram.frameTitle,
        tabHeight: LC_TAB_H,
        tabWidth: LC_TAB_W,
      },
    };

    const tiles: DiagramLeafNode[] = diagram.nodes.map((node) => {
      const box = layout.boxes[node.id];
      const isStage = (node.lifecycleRole ?? 'stage') === 'stage';
      return {
        id: node.id,
        type: isStage ? 'lifecycleStage' : 'lifecycleBand',
        position: overrides.pos[node.id] ?? { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        zIndex: 10,
        draggable: editMode,
        selectable: editMode,
        selected: selectedIds?.has(node.id) ?? false,
        connectable: false,
        ariaLabel: node.title,
        data: {
          def: node,
          groupTitle: 'CANVAS',
          groupColor: 'soft',
          groupKind: 'canvas',
          interaction: leafInteraction(node.id, options.selection.nodeId, neighbours, step),
          embedMode: options.embedMode ?? false,
          lifecyclePoint: isStage ? LC_STAGE_POINT * spacing : 0,
        },
      };
    });

    // One stage can both send and receive feedback; in the source figure that
    // is the only case where an end leaves the stage's centre line, so the
    // split is derived from the edge list rather than authored per stage.
    const sends = new Set(diagram.edges.map((edge) => edge.from));
    const receives = new Set(diagram.edges.map((edge) => edge.to));
    const split = (id: string) => (sends.has(id) && receives.has(id) ? LC_BUS_SPLIT * spacing : 0);
    // LC_BUS_Y is FRAME-relative and the chrome box starts at the tab, so the
    // tab height is part of the conversion to canvas coordinates. Dropping it
    // put the rail 3px under the chevrons and collapsed every arrow's legs.
    const busY = chromeBox.y + LC_TAB_H + LC_BUS_Y;

    const busEdges: DiagramFlowEdge[] = diagram.edges.map((edge) => {
      const interaction = edgeInteraction(edge, options.selection.nodeId, step);
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'lifecycleBus' as const,
        zIndex: interaction === 'active' ? 3 : 1,
        selectable: false,
        focusable: false,
        interactionWidth: 20,
        markerEnd: {
          type: MarkerType.Arrow,
          width: 14,
          height: 14,
          strokeWidth: 1.6,
          color: markerColor(diagram, interaction, options.theme, false),
        },
        data: {
          def: edge,
          interaction,
          isIsland: false,
          stepActive: false,
          editMode,
          textScale,
          lifecycleBusY: busY,
          lifecycleOutOffset: split(edge.from),
          lifecycleInOffset: -split(edge.to),
        },
      };
    });

    return { nodes: [chrome, ...tiles, ...legendNodes], edges: busEdges, layout };
  }

  if (diagram.dialect === 'pyramid') {
    const tiers = [...diagram.nodes].sort((a, b) => a.row - b.row);
    const extentWidth = Math.max(
      ...tiers.map((node) => layout.boxes[node.id].x + layout.boxes[node.id].width),
    );
    const extentHeight = Math.max(
      ...tiers.map((node) => layout.boxes[node.id].y + layout.boxes[node.id].height),
    );

    const chrome: PyramidChromeNode = {
      id: '__pyramid-chrome',
      type: 'pyramidChrome',
      position: { x: 0, y: 0 },
      width: extentWidth,
      height: extentHeight,
      zIndex: -10,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      data: {
        title: diagram.title,
        subtitle: diagram.subtitle,
        axisLabel: diagram.axisLabel,
        axisTop: PYR_HEADING_H,
        axisHeight: extentHeight - PYR_HEADING_H,
      },
    };

    const bars: DiagramLeafNode[] = tiers.map((node, index) => {
      const box = layout.boxes[node.id];
      return {
        id: node.id,
        type: 'pyramidBar',
        position: overrides.pos[node.id] ?? { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        // Upper tiers stack above lower ones so a downward-opening embed
        // notes card is never clipped by the next bar.
        zIndex: 10 + (tiers.length - index),
        draggable: editMode,
        selectable: editMode,
        selected: selectedIds?.has(node.id) ?? false,
        connectable: false,
        ariaLabel: `${node.title}${node.subtitle ? ` — ${node.subtitle}` : ''}`,
        data: {
          def: node,
          groupTitle: 'CANVAS',
          groupColor: 'soft',
          groupKind: 'canvas',
          interaction: leafInteraction(node.id, options.selection.nodeId, neighbours, step),
          embedMode: options.embedMode ?? false,
          pyramidRow: index,
          pyramidRows: tiers.length,
        },
      };
    });

    return { nodes: [chrome, ...bars, ...legendNodes], edges: [], layout };
  }

  /** Parent-relative position from the absolute layout boxes. */
  const relativePosition = (id: string, parentId?: string) => {
    const box = layout.boxes[id];
    if (!parentId) return { x: box.x, y: box.y };
    const parentBox = layout.boxes[parentId];
    return { x: box.x - parentBox.x, y: box.y - parentBox.y };
  };

  // Parents must precede children in the nodes array (React Flow contract).
  // The csdm hub is NOT a group: it holds no cards and is drawn as chrome
  // over the join, so it leaves the group pass entirely.
  const isCsdm = diagram.dialect === 'csdm';
  const hubGroup = isCsdm
    ? diagram.groups.find((group) => group.domain === 'portfolio')
    : undefined;
  const orderedGroups = [...diagram.groups]
    .filter((group) => group !== hubGroup)
    .sort((a, b) => groupDepth(a, groupMap) - groupDepth(b, groupMap));
  const hubBox = hubGroup ? layout.boxes[hubGroup.id] : undefined;
  const hubNodes: CsdmHubNode[] = hubGroup && hubBox ? [{
    id: hubGroup.id,
    type: 'csdmHub',
    position: { x: hubBox.x, y: hubBox.y },
    width: hubBox.width,
    height: hubBox.height,
    // Above the regions (-10), below the cards (10) and the edges.
    zIndex: -4,
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    data: { title: hubGroup.title, icon: hubGroup.icon ?? 'briefcase' },
  }] : [];

  /**
   * Style overrides as inline custom properties. Shared by groups and leaves:
   * a group is selectable in edit mode and the style bar offered it text,
   * outline and size, so a group that ignored them persisted an edit with no
   * visible effect (cross-vendor review, 2026-09-15).
   */
  const styleVarsFor = (id: string): Record<string, string> | undefined => {
    const style = nodeStyles[id];
    if (!style) return undefined;
    return {
      ...(style.textScale !== undefined
        ? { '--dg-node-text-scale': String(style.textScale) } : {}),
      ...(style.ink ? { '--dg-node-ink': style.ink } : {}),
      ...(style.border ? { '--csdm-ink': style.border, '--dg-card-hairline': style.border } : {}),
    };
  };

  const groups: DiagramGroupNode[] = orderedGroups.map((group) => {
    const box = layout.boxes[group.id];
    const depth = groupDepth(group, groupMap);
    const size = overrides.size[group.id];
    const groupStyleVars = styleVarsFor(group.id);
    return {
      id: group.id,
      type: isCsdm ? 'csdmRegion' : 'diagramGroup',
      parentId: group.parent,
      ...(group.parent && editMode ? { extent: 'parent' as const } : {}),
      position: overrides.pos[group.id] ?? relativePosition(group.id, group.parent),
      width: size?.width ?? box.width,
      height: size?.height ?? box.height,
      ...(groupStyleVars ? { style: groupStyleVars } : {}),
      // View mode keeps groups behind everything (-10+depth). Edit mode
      // lifts them to non-negative z so the pane's lasso cannot swallow their
      // pointer events — leaves stay far above at z 10.
      //
      // Groups do NOT out-stack edges, and no z-index here can make them:
      // React Flow elevates an edge to `max(endpoint z) + 1`, so an edge
      // between two leaves lands at 11, and lifting a group past that would
      // paint it over the very cards it contains. Edit-mode edge selection is
      // therefore bought with the documented fallback, not with z-order — a
      // 10px interaction corridor plus `pointer-events: stroke` (see
      // diagrams.css) — which means a pointer-down within ~5px of a VISIBLE
      // line grabs the line rather than the region beneath it. That is the
      // accepted trade; the defect the old blanket rule fixed was a 20px
      // INVISIBLE corridor, which this is not.
      zIndex: editMode ? depth : -10 + depth,
      draggable: editMode,
      selectable: editMode,
      selected: selectedIds?.has(group.id) ?? false,
      connectable: false,
      focusable: editMode,
      data: { def: group, depth, editable: editMode },
    };
  });

  const leaves: DiagramLeafNode[] = diagram.nodes.map((node) => {
    const box = layout.boxes[node.id];
    const group = node.group ? groupMap.get(node.group) : undefined;
    // Inline custom properties cascade into whichever renderer this dialect
    // uses, so no second styling pathway is introduced.
    // --dg-node-text-scale multiplies the global --dg-text-scale;
    // --dg-node-ink recolours the type; --csdm-ink recolours the card outline
    // (and the inline-SVG silhouette stroke, which already reads it).
    const styleVars = styleVarsFor(node.id);
    return {
      id: node.id,
      type: diagram.dialect === 'aws'
        ? 'awsTile'
        : diagram.dialect === 'csdm' ? 'csdmCard' : 'diagramNode',
      parentId: node.group,
      // A csdm role figure sits in the GUTTER beside its region, so it is a
      // child of that region without being confined to it. `extent: 'parent'`
      // clamps a child into the parent box, which drags every gutter figure
      // back on top of the cards it is meant to sit beside.
      ...(node.group && !(isCsdm && node.figure && node.gutter !== 'below')
        ? { extent: 'parent' as const }
        : {}),
      position: overrides.pos[node.id] ?? relativePosition(node.id, node.group),
      width: box.width,
      height: box.height,
      ...(styleVars ? { style: styleVars } : {}),
      zIndex: 10,
      draggable: editMode,
      selectable: editMode,
      selected: selectedIds?.has(node.id) ?? false,
      connectable: false,
      ariaLabel: `${node.title}${node.subtitle ? ` — ${node.subtitle}` : ''}`,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        def: node,
        groupTitle: group?.title ?? 'CANVAS',
        groupColor: group?.color ?? 'soft',
        groupKind: group?.kind ?? 'canvas',
        interaction: leafInteraction(
          node.id,
          options.selection.nodeId,
          neighbours,
          step,
        ),
        embedMode: options.embedMode ?? false,
        ownerLabel: node.owner ? partyLabel(diagram, node.owner, 'short') : undefined,
      },
    };
  });

  // An edge whose endpoint is a GROUP id renders NOWHERE and fails silently:
  // groups are locked pass-through (pointer-events none, z-index below the
  // leaves), so there is no valid anchor. Field-caught only when a human
  // noticed a load-bearing edge missing from a client-facing diagram — hence
  // the loud console error. Fix in the DATA: re-anchor to a representative node
  // inside each group, keeping the label and the logical meaning.
  const leafIds = new Set(diagram.nodes.map((node) => node.id));
  const groupIds = new Set((diagram.groups ?? []).map((group) => group.id));
  diagram.edges.forEach((edge) => {
    (['from', 'to'] as const).forEach((end) => {
      const id = edge[end];
      if (leafIds.has(id)) return;
      const why = groupIds.has(id)
        ? 'is a GROUP id (groups are pass-through — re-anchor to a node inside it)'
        : 'matches no node in this diagram';
      console.error(`[arc-diagram] ${diagram.id}: edge "${edge.id}" ${end}="${id}" ${why}; this edge will not render.`);
    });
  });

  const edges: DiagramFlowEdge[] = diagram.edges.map((edge) => {
    const interaction = edgeInteraction(edge, options.selection.nodeId, step);
    const edgeStyle = options.edgeEdits?.[edge.id];
    const isAws = diagram.dialect === 'aws';
    const sourceGroup = diagram.nodes.find((node) => node.id === edge.from)?.group;
    const targetGroup = diagram.nodes.find((node) => node.id === edge.to)?.group;
    // The quilt keeps its own ink everywhere; island treatment is an
    // editorial device for a pastel block and has no meaning here.
    const isIsland = !isCsdm
      && sourceGroup !== undefined
      && sourceGroup === targetGroup
      && groupMap.get(sourceGroup)?.kind === 'block';
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: isAws ? 'aws' : 'floating',
      ...(isAws ? fixedHandles(edge, layout) : {}),
      zIndex: interaction === 'active' ? 3 : 1,
      // Edit mode makes relationships first-class objects: selectable by the
      // label, the line or the arrowhead corridor, so they can be recoloured.
      // View mode keeps them inert.
      selectable: editMode,
      focusable: editMode,
      selected: selectedIds?.has(edge.id) ?? false,
      // NOTE: interactionWidth 0 is falsy (React Flow substitutes the
      // default 20) — edit mode kills edge pointer events via CSS instead
      // (.dg-canvas.is-editing rules in diagrams.css, field-caught).
      interactionWidth: 20,
      markerEnd: {
        type: isAws ? MarkerType.Arrow : MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        // A per-edge colour override paints the arrowhead as well as the line;
        // recolouring one and not the other reads as a rendering fault.
        color: edgeStyle?.color
          ?? markerColor(diagram, interaction, options.theme, isIsland),
      },
      data: {
        def: edge,
        interaction,
        isIsland,
        stepActive: step?.n === edge.stepNo,
        positionFraction: EDGE_POSITION_FRACTIONS[diagram.id]?.[edge.id],
        editMode,
        textScale,
        edgeEdit: isAws ? undefined : edgeStyle,
        onEdgeEdit: isAws ? undefined : options.onEdgeEdit,
        onEdgeSelect: isAws ? undefined : options.onEdgeSelect,
        onStepSelect: edge.stepNo === undefined ? undefined : options.onStepSelect,
      },
    };
  });

  return { nodes: [...groups, ...hubNodes, ...leaves, ...legendNodes], edges, layout };
}
