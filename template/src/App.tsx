import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type EdgeChange,
  type EdgeMouseHandler,
  type EdgeTypes,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import {
  buildGraph,
  EMPTY_OVERRIDES,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  type EdgeLayoutEdit,
  type LayoutOverrides,
} from './buildGraph';
import {
  EMPTY_EDGE_EDITS,
  PERSIST_KEY,
  SPACING_MAX,
  SPACING_MIN,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  clampNumber,
  loadPersistState,
  type PersistState,
} from './persistState';
import { makeMinimapNodeColor, SideResizer, ZoomReadout } from './canvasChrome';
import { SettingsMenu } from './SettingsMenu';
import { StyleBar } from './StyleBar';
import { useStyleEditing } from './useStyleEditing';
import { useUiPrefs } from './useUiPrefs';
import { diagrams } from './data/diagram-set';
import { project } from './project';
import { LifecycleBand, LifecycleChrome, LifecycleStage } from './nodes/LifecycleStage';
import { LifecycleBusEdge } from './edges/LifecycleBusEdge';
import { DetailPanel } from './DetailPanel';
import { LegendChromeNode } from './nodes/LegendChromeNode';
import { DiagramRail } from './DiagramRail';
import { AwsEdge } from './edges/AwsEdge';
import { cancelEdgeDrag, FloatingDiagramEdge } from './edges/FloatingDiagramEdge';
import { EdgeRoutesProvider, setEdgeRouteDragging } from './edges/useEdgeRoutes';
import { DEFAULT_SPACING } from './layout';
import type { DiagramDef } from './model';
import { AwsTile } from './nodes/AwsTile';
import { DiagramGroup } from './nodes/DiagramGroup';
import { DiagramNode } from './nodes/DiagramNode';
import { CsdmCard } from './nodes/CsdmCard';
import { CsdmHub } from './nodes/CsdmHub';
import { CsdmRegion } from './nodes/CsdmRegion';
import { PyramidBar, PyramidChrome } from './nodes/PyramidBar';
import { StepsPanel } from './StepsPanel';
import {
  DIAGRAM_THEME_PALETTES,
  type DiagramTheme,
} from './theme';

declare global {
  interface Window {
    __ARC_STATE__?: PersistState | null;
    __dg?: {
      diagrams: Array<{ id: string; title: string; section?: string }>;
      activeId: string;
      switchTo(id: string): void;
    };
  }
}

const SPACING_STEP = 0.15;

const nodeTypes: NodeTypes = {
  diagramNode: DiagramNode,
  diagramGroup: DiagramGroup,
  awsTile: AwsTile,
  pyramidBar: PyramidBar,
  pyramidChrome: PyramidChrome,
  csdmRegion: CsdmRegion,
  csdmCard: CsdmCard,
  csdmHub: CsdmHub,
  legendChrome: LegendChromeNode,
  lifecycleStage: LifecycleStage,
  lifecycleBand: LifecycleBand,
  lifecycleChrome: LifecycleChrome,
};

const edgeTypes: EdgeTypes = {
  floating: FloatingDiagramEdge,
  aws: AwsEdge,
  lifecycleBus: LifecycleBusEdge,
};

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function initialTheme(): DiagramTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function loadRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem('dg-diagram-rail') === 'closed';
  } catch {
    return false;
  }
}

function ThemeGlyph({ theme }: { theme: DiagramTheme }) {
  return theme === 'dark' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.2A8.4 8.4 0 0 1 8.8 4a8.4 8.4 0 1 0 11.2 11.2Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function slugify(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

/**
 * Embed mode: `?embed=<diagramId>` renders that one diagram only — no tab
 * strip, no brand bar, no right rail, no diagram switching — for placing a
 * single diagram inside a document (an iframe per section) or for a
 * chrome-free batch export. Reads `location.search` at startup so it works
 * over file:// and http alike.
 */
function embedDiagramIndex(): number {
  try {
    const id = new URLSearchParams(window.location.search).get('embed');
    if (!id) return -1;
    return diagrams.findIndex((candidate) => candidate.id === id);
  } catch {
    return -1;
  }
}

/**
 * Self-contained export by cloning the LIVE document: the running page is
 * already a single-file bundle (vite-plugin-singlefile), so the clone carries
 * its own inline JS/CSS/fonts. Empty #root so the copy boots cleanly, and write
 * the layout state into the #arc-state script.
 *
 * This replaces an earlier fetch-the-offline-template-and-string-replace-a-
 * sentinel scheme, and deletes that scheme's whole failure class (minifiers
 * constant-fold split string literals, so the sentinel reappeared inside the
 * bundle and .replace() corrupted the app's own source).
 */
function serialiseSelfContainedDocument(persist: PersistState): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  const root = clone.querySelector<HTMLElement>('#root');
  const stateScript = clone.querySelector<HTMLScriptElement>('#arc-state');
  if (!root || !stateScript) throw new Error('self-contained document markers missing');
  root.replaceChildren();
  const payload = JSON.stringify(persist).replaceAll('<', '\\u003c');
  stateScript.textContent = `window.__ARC_STATE__=${payload}`;
  return `<!doctype html>\n${clone.outerHTML}`;
}

function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
}

function DiagramPage() {
  const { fitView } = useReactFlow<DiagramFlowNode, DiagramFlowEdge>();
  const [embedIndex] = useState(embedDiagramIndex);
  const embedActive = embedIndex >= 0;
  const [activeIndex, setActiveIndex] = useState(embedActive ? embedIndex : 0);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(loadRailCollapsed);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [activeStepNo, setActiveStepNo] = useState<number>();
  const [theme, setTheme] = useState<DiagramTheme>(initialTheme);
  const [editMode, setEditMode] = useState(false);
  const [persist, setPersist] = useState<PersistState>(loadPersistState);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef<HTMLElement>(null);
  const hostContractMountedRef = useRef(false);
  const textScaleSettleRef = useRef<number>();
  /**
   * Forces the edge-route memo to re-evaluate. `setEdgeRouteDragging` only
   * writes a module-level boolean; the route selector reads it but re-runs
   * only when the React Flow store changes. A node drag gets that for free —
   * the drop is itself a position change — but a stepper settle has no
   * subsequent change of its own, so clearing the flag alone left the canvas
   * showing light-mode routes indefinitely (cross-vendor review, 2026-09-15;
   * measured as zero full passes after a settle). Bumping this rebuilds the
   * graph, which updates the store, which re-runs the selector with the flag
   * down.
   */
  const [routeEpoch, bumpRouteEpoch] = useReducer((value: number) => value + 1, 0);
  const diagram = diagrams[activeIndex];
  const themePalette = DIAGRAM_THEME_PALETTES[theme];
  const spacing = persist.spacing[diagram.id] ?? DEFAULT_SPACING[diagram.id] ?? 1;
  const textScale = persist.textScale[diagram.id] ?? 1;
  const overrides = persist.overrides[diagram.id] ?? EMPTY_OVERRIDES;
  const edgeEdits = persist.edges[diagram.id] ?? EMPTY_EDGE_EDITS;

  const updatePersist = useCallback(
    (mutate: (current: PersistState) => PersistState) => setPersist(mutate),
    [],
  );
  const uiPrefs = useUiPrefs(persist, updatePersist);
  const styleEditing = useStyleEditing(diagram.id, persist, updatePersist);
  const { ui } = uiPrefs;
  /**
   * Embed mode is chrome-free BY CONTRACT — one diagram, no rails, no menus,
   * no canvas furniture — because it is what a document iframe and the static
   * PNG exporter both render. New chrome has to opt OUT here in the same
   * change that adds it; the exporter hides a hard-coded selector list and
   * cannot know about a control it has never heard of.
   */
  const sidecarMode = embedActive ? 'hidden' : ui.sidecar;
  const toolVisible = useCallback(
    (tool: Parameters<typeof uiPrefs.toolVisible>[0]) => !embedActive && uiPrefs.toolVisible(tool),
    [embedActive, uiPrefs],
  );

  useEffect(() => {
    // Debounced: during a drag the overrides change per frame, and a full
    // JSON.stringify of the persist blob per frame is measurable jank on the
    // large diagrams. One write 300ms after the last change is equivalent.
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(PERSIST_KEY, JSON.stringify(persist));
      } catch {
        // Layout edits still apply in-memory when storage is unavailable.
      }
    }, 300);
    // pagehide flush: without it, an edit made <300ms before the tab closes
    // would be lost.
    const flush = () => {
      window.clearTimeout(handle);
      try {
        window.localStorage.setItem(PERSIST_KEY, JSON.stringify(persist));
      } catch {
        // Storage unavailable - nothing to flush.
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener('pagehide', flush);
    };
  }, [persist]);

  // Light-mode flag backstops: a drag released outside the window, an
  // edit-mode exit, or a tab switch can otherwise strand the flag true and
  // leave routing in light mode permanently (cross-vendor verify findings,
  // 2026-08-20). A stray clear is harmless — the next drag frame re-sets it.
  useEffect(() => {
    setEdgeRouteDragging(false);
  }, [editMode]);
  useEffect(() => {
    const clear = () => setEdgeRouteDragging(false);
    window.addEventListener('pointerup', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNodeId(undefined);
    setActiveStepNo(undefined);
    setSelectedIds(new Set());
    setSelectedEdgeIds(new Set());
  }, []);

  const selectStep = useCallback((stepNo: number) => {
    setSelectedNodeId(undefined);
    setActiveStepNo((current) => current === stepNo ? undefined : stepNo);
  }, []);

  const switchDiagram = useCallback((index: number) => {
    if (embedActive) return; // Embed mode: the user cannot switch diagrams.
    // An edge drag session lives at window level and deliberately outlives the
    // edge component (it remounts mid-drag). It was cancelled on an edit-mode
    // exit but not on a diagram switch, so a held pointer went on committing
    // edits to the diagram you just left (cross-vendor review, 2026-09-15).
    cancelEdgeDrag();
    setActiveIndex(index);
    setSelectedNodeId(undefined);
    setActiveStepNo(undefined);
    setSelectedIds(new Set());
    setSelectedEdgeIds(new Set());
    setSettingsOpen(false);
  }, [embedActive]);

  useEffect(() => {
    window.__dg = {
      diagrams: diagrams.map(({ id, title, section }) => ({ id, title, section })),
      activeId: diagram.id,
      switchTo: (id: string) => {
        const index = diagrams.findIndex((candidate) => candidate.id === id);
        if (index >= 0) switchDiagram(index);
      },
    };
    if (hostContractMountedRef.current) {
      document.dispatchEvent(new CustomEvent('dg:diagram-change', {
        detail: { id: diagram.id, title: diagram.title, index: activeIndex },
      }));
    } else {
      hostContractMountedRef.current = true;
    }
  }, [activeIndex, diagrams, embedActive, switchDiagram]);

  const toggleRail = useCallback(() => {
    setRailCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem('dg-diagram-rail', next ? 'closed' : 'open');
      } catch {
        // The in-memory choice still applies when storage is unavailable.
      }
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      window.localStorage.setItem('dg-theme', next);
    } catch {
      // The in-memory choice still applies when storage is unavailable.
    }
    setTheme(next);
  }, [theme]);

  const setSpacing = useCallback((value: number) => {
    const clamped = Math.round(
      Math.min(SPACING_MAX, Math.max(SPACING_MIN, value)) * 100,
    ) / 100;
    setPersist((current) => ({
      ...current,
      spacing: { ...current.spacing, [diagram.id]: clamped },
    }));
  }, [diagram.id]);

  /**
   * The stepper sets the SAME light-routing flag a node drag sets, and clears
   * it on a settle timer. Without this a click lands on the full A* route
   * pass — measured at 971ms on the large diagram, which is why the light
   * path exists at all — and a run of clicks freezes the canvas on every
   * increment. One full recompute runs once the clicking stops.
   */
  const setTextScale = useCallback((value: number) => {
    const clamped = Math.round(
      clampNumber(value, TEXT_SCALE_MIN, TEXT_SCALE_MAX) * 100,
    ) / 100;
    setEdgeRouteDragging(true);
    window.clearTimeout(textScaleSettleRef.current);
    textScaleSettleRef.current = window.setTimeout(() => {
      setEdgeRouteDragging(false);
      bumpRouteEpoch();
    }, 250);
    setPersist((current) => ({
      ...current,
      textScale: { ...current.textScale, [diagram.id]: clamped },
    }));
  }, [diagram.id]);

  useEffect(() => () => {
    // A stranded settle timer would leave routing in light mode permanently,
    // the same failure class the drag-flag backstops above already guard.
    window.clearTimeout(textScaleSettleRef.current);
    setEdgeRouteDragging(false);
  }, []);

  const updateOverrides = useCallback((
    mutate: (current: LayoutOverrides) => LayoutOverrides,
  ) => {
    setPersist((current) => ({
      ...current,
      overrides: {
        ...current.overrides,
        [diagram.id]: mutate(current.overrides[diagram.id] ?? EMPTY_OVERRIDES),
      },
    }));
  }, [diagram.id]);

  const updateEdgeEdit = useCallback((edgeId: string, edit: EdgeLayoutEdit) => {
    setPersist((current) => {
      const diagramEdges = { ...(current.edges[diagram.id] ?? EMPTY_EDGE_EDITS) };
      if ((!edit.waypoints || edit.waypoints.length === 0)
        && edit.labelFraction === undefined
        // Style overrides are not geometry: deleting the record when the last
        // waypoint goes silently threw away an unlabelled edge's colour and
        // label size (cross-vendor review, 2026-09-15).
        && edit.labelScale === undefined
        && !edit.color) {
        delete diagramEdges[edgeId];
      } else {
        diagramEdges[edgeId] = edit;
      }
      const edges = { ...current.edges };
      if (Object.keys(diagramEdges).length === 0) delete edges[diagram.id];
      else edges[diagram.id] = diagramEdges;
      return { ...current, edges };
    });
  }, [diagram.id]);

  const resetLayout = useCallback(() => {
    setPersist((current) => {
      const nextOverrides = { ...current.overrides };
      delete nextOverrides[diagram.id];
      const nextSpacing = { ...current.spacing };
      delete nextSpacing[diagram.id];
      const nextEdges = { ...current.edges };
      delete nextEdges[diagram.id];
      const nextTextScale = { ...current.textScale };
      delete nextTextScale[diagram.id];
      const nextStyles = { ...current.styles };
      delete nextStyles[diagram.id];
      // Interface preferences survive a reset: where the inspector sits is a
      // property of how you work, not of this diagram's edits.
      return {
        spacing: nextSpacing,
        textScale: nextTextScale,
        overrides: nextOverrides,
        styles: nextStyles,
        edges: nextEdges,
        ui: current.ui,
      };
    });
  }, [diagram.id]);

  /**
   * Nodes and edges are both React-Flow-selected from one id set, because the
   * graph builder marks whichever element carries the id. They are tracked
   * SEPARATELY in state so the style bar can tell a component from a
   * relationship and write only the overrides that apply to each.
   */
  const allSelectedIds = useMemo(
    () => new Set<string>([...selectedIds, ...selectedEdgeIds]),
    [selectedEdgeIds, selectedIds],
  );

  const selectEdge = useCallback((edgeId: string, additive: boolean) => {
    setSelectedEdgeIds((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (additive && current.has(edgeId)) next.delete(edgeId);
      else next.add(edgeId);
      return next;
    });
    if (!additive) setSelectedIds(new Set());
  }, []);

  const graph = useMemo(() => buildGraph(diagram, {
    selection: { nodeId: selectedNodeId, stepNo: activeStepNo },
    onStepSelect: selectStep,
    theme: themePalette,
    spacing,
    textScale,
    nodeStyles: styleEditing.nodeStyles,
    editMode,
    overrides,
    edgeEdits,
    onEdgeEdit: updateEdgeEdit,
    onEdgeSelect: selectEdge,
    selectedIds: allSelectedIds,
    embedMode: embedActive,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    routeEpoch,
  }), [
    activeStepNo,
    diagram,
    editMode,
    edgeEdits,
    embedActive,
    overrides,
    routeEpoch,
    selectStep,
    selectEdge,
    allSelectedIds,
    selectedNodeId,
    spacing,
    styleEditing.nodeStyles,
    textScale,
    themePalette,
    updateEdgeEdit,
  ]);

  const selectedNode = selectedNodeId
    ? diagram.nodes.find((node) => node.id === selectedNodeId)
    : undefined;

  const handleNodesChange = useCallback((changes: NodeChange<DiagramFlowNode>[]) => {
    const posChanges = changes.filter(
      (change): change is Extract<NodeChange<DiagramFlowNode>, { type: 'position' }> =>
        change.type === 'position' && change.position !== undefined,
    );
    // Route computation runs in cheap light mode while a drag is in flight;
    // the full routing + label pass runs once, on the drop (971ms full
    // computes per drag frame made dragging unusable — measured 2026-08-20).
    // The flag updates BEFORE the editMode guard: exiting edit mode mid-drag
    // otherwise skips the terminal dragging:false and light mode sticks
    // (cross-vendor verify finding, 2026-08-20).
    if (posChanges.length > 0) {
      setEdgeRouteDragging(posChanges.some((change) => change.dragging === true));
    }
    if (!editMode) return;
    const sizeChanges = changes.filter(
      (change): change is Extract<NodeChange<DiagramFlowNode>, { type: 'dimensions' }> =>
        change.type === 'dimensions' && change.dimensions !== undefined && change.resizing === true,
    );
    if (posChanges.length > 0 || sizeChanges.length > 0) {
      updateOverrides((current) => ({
        pos: {
          ...current.pos,
          ...Object.fromEntries(posChanges.map((change) => [
            change.id,
            { x: change.position!.x, y: change.position!.y },
          ])),
        },
        size: {
          ...current.size,
          ...Object.fromEntries(sizeChanges.map((change) => [
            change.id,
            { width: change.dimensions!.width, height: change.dimensions!.height },
          ])),
        },
      }));
    }
    const selectChanges = changes.filter((change) => change.type === 'select');
    if (selectChanges.length > 0) {
      setSelectedIds((current) => {
        const next = new Set(current);
        selectChanges.forEach((change) => {
          if (change.type !== 'select') return;
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        });
        return next;
      });
    }
  }, [editMode, updateOverrides]);

  const handleEdgesChange = useCallback((changes: EdgeChange<DiagramFlowEdge>[]) => {
    if (!editMode) return;
    const selectChanges = changes.filter((change) => change.type === 'select');
    if (selectChanges.length === 0) return;
    setSelectedEdgeIds((current) => {
      const next = new Set(current);
      selectChanges.forEach((change) => {
        if (change.type !== 'select') return;
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      });
      return next;
    });
  }, [editMode]);

  const nudgeSelection = useCallback((dx: number, dy: number) => {
    if (selectedIds.size === 0) return;
    const positions = new Map(graph.nodes.map((node) => [node.id, node.position]));
    updateOverrides((current) => ({
      ...current,
      pos: {
        ...current.pos,
        ...Object.fromEntries([...selectedIds].map((id) => {
          const base = current.pos[id] ?? positions.get(id) ?? { x: 0, y: 0 };
          return [id, { x: base.x + dx, y: base.y + dy }];
        })),
      },
    }));
  }, [graph.nodes, selectedIds, updateOverrides]);

  const downloadPng = useCallback(async () => {
    const pane = canvasRef.current?.querySelector<HTMLElement>('.react-flow');
    if (!pane) return;
    setSettingsOpen(false);
    setExporting(true);
    try {
      await fitView({ padding: 0.08, duration: 0 });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const dataUrl = await toPng(pane, {
        pixelRatio: 2,
        // Matches --dg-canvas-field. These were hard-coded and divergent from
        // the tokens for no recorded reason; the export now prints the field
        // the reader actually saw.
        backgroundColor: theme === 'dark' ? '#17181a' : '#fbfbfa',
        filter: (element) => {
          if (!(element instanceof HTMLElement)) return true;
          // ANCESTOR test, not a self test: the old check looked only at the
          // element itself, so the minimap's and panels' CHILDREN printed
          // into the PNG even when their container was filtered out.
          return !element.closest?.(
            '.react-flow__controls, .react-flow__minimap, .react-flow__panel,'
            + ' .dg-style-bar, .dg-edit-hint',
          );
        },
      });
      triggerDownload(dataUrl, `arc-${slugify(diagram.title)}-${theme}.png`);
    } finally {
      setExporting(false);
    }
  }, [diagram.title, fitView, theme]);

  const downloadOffline = useCallback(() => {
    setSettingsOpen(false);
    try {
      const documentHtml = serialiseSelfContainedDocument(persist);
      const blob = new Blob([documentHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'architecture-diagrams.html');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      window.alert(
        'Self-contained export failed. '
        + `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }, [persist]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.1, duration: 300 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [diagram.id, fitView]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        clearSelection();
        setSettingsOpen(false);
        return;
      }
      if (editMode && selectedIds.size > 0 && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 32 : 8;
        if (event.key === 'ArrowLeft') nudgeSelection(-step, 0);
        if (event.key === 'ArrowRight') nudgeSelection(step, 0);
        if (event.key === 'ArrowUp') nudgeSelection(0, -step);
        if (event.key === 'ArrowDown') nudgeSelection(0, step);
        return;
      }
      if (event.key.toLowerCase() === 'd') {
        toggleTheme();
        return;
      }
      if (event.key.toLowerCase() === 'e') {
        setEditMode((current) => !current);
        setSelectedIds(new Set());
        setSelectedEdgeIds(new Set());
        return;
      }
      if (event.key.toLowerCase() === 'i') {
        uiPrefs.toggleSidecar();
        return;
      }
      if (event.key.toLowerCase() === 'l') {
        toggleRail();
        return;
      }
      if (embedActive) return; // Embed mode: no tab switching.
      // Number keys 1-9 select tabs 1-9; 0 selects the tenth (arc42 sets run long).
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      if (index >= 0 && index < diagrams.length) switchDiagram(index);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, editMode, embedActive, nudgeSelection, selectedIds, switchDiagram, toggleRail, toggleTheme, uiPrefs]);

  const minimapNodeColor = useMemo(() => makeMinimapNodeColor(diagram), [diagram]);

  /**
   * What the style bar writes to. Selection ids are partitioned back into
   * nodes and edges here, because one id set drives React Flow but the two
   * kinds take different overrides.
   */
  const styleTargets = useMemo(() => ({
    nodeIds: [...selectedIds],
    edgeIds: [...selectedEdgeIds],
  }), [selectedEdgeIds, selectedIds]);

  /** The inspector, hosted either in the right column or inside the rail. */
  const inspector: ReactNode = (
    <>
      {diagram.steps && (
        <StepsPanel
          steps={diagram.steps}
          activeStepNo={activeStepNo}
          onStepSelect={selectStep}
        />
      )}
      <DetailPanel
        diagram={diagram}
        node={selectedNode}
        // Views without their own legend resolve control tags against the
        // one view in the set that declares the full vocabulary.
        legend={diagram.legend ?? diagrams.find((entry) => entry.legend)?.legend}
      />
    </>
  );

  const handleNodeClick: NodeMouseHandler<DiagramFlowNode> = (_event, node) => {
    if (node.type === 'diagramGroup' || node.type === 'csdmRegion'
      || node.type === 'pyramidChrome' || node.type === 'csdmHub'
      || node.type === 'lifecycleChrome' || node.type === 'legendChrome') return;
    if (editMode) return; // Edit mode: clicks manage React Flow selection instead.
    setActiveStepNo(undefined);
    setSelectedNodeId(node.id);
    // The inspector is hidden by default and OPENS on a component click, in
    // whichever mode it was last docked. In merged mode it lives inside the
    // diagram list, so a collapsed rail has to expand or the panel it was
    // just asked for is invisible.
    if (!embedActive) {
      uiPrefs.openSidecar();
      if (ui.sidecar === 'left' && railCollapsed) toggleRail();
    }
  };

  const handleEdgeClick: EdgeMouseHandler<DiagramFlowEdge> = (_event, edge) => {
    // Edit mode: React Flow already applies its own selection change for a
    // click on the line or its arrowhead corridor, and `handleEdgesChange`
    // records it. Toggling here as well double-handled a shift-click — the
    // edge was added and immediately removed again (cross-vendor review,
    // 2026-09-15). The LABEL is a different path: it lives in the edge-label
    // renderer, outside React Flow's own click handling, so it calls
    // `selectEdge` itself.
    if (editMode) return;
    const stepNo = edge.data?.def.stepNo;
    if (stepNo !== undefined) selectStep(stepNo);
  };

  return (
    <main className={`dg-app ${embedActive ? 'is-embed' : ''}`}>
      {!embedActive && (
      <header className={`dg-topbar ${embedActive ? 'is-embed' : ''}`}>
        {!embedActive && (
        <div className="dg-brand">
          <span>{project.eyebrow}</span>
          <h1>{project.title}</h1>
        </div>
        )}
        {!embedActive && (
        <div className="dg-topbar-current" title={diagram.title}>
          <span>Diagram {activeIndex + 1} of {diagrams.length}</span>
          <strong>{diagram.title}</strong>
        </div>
        )}
        <div className="dg-topbar-actions">
          <div className="dg-toolbar" role="toolbar" aria-label="Diagram tools">
            <button
              className={`dg-tool ${editMode ? 'is-active' : ''}`}
              type="button"
              aria-pressed={editMode}
              title="Toggle edit mode (E) — drag cards, lasso-select, arrow keys nudge, resize groups, restyle a selection"
              onClick={() => {
                setEditMode((current) => !current);
                setSelectedIds(new Set());
                setSelectedEdgeIds(new Set());
              }}
            >
              Edit
            </button>
            <div className="dg-spacing" aria-label="Text size">
              <button
                className="dg-tool"
                type="button"
                title="Smaller text"
                aria-label="Smaller text"
                onClick={() => setTextScale(textScale - TEXT_SCALE_STEP)}
              >
                A−
              </button>
              <button
                className="dg-spacing-value dg-text-scale-value"
                type="button"
                title="Reset text size to 100%"
                onClick={() => setTextScale(1)}
              >
                {Math.round(textScale * 100)}%
              </button>
              <button
                className="dg-tool"
                type="button"
                title="Larger text"
                aria-label="Larger text"
                onClick={() => setTextScale(textScale + TEXT_SCALE_STEP)}
              >
                A+
              </button>
            </div>
            <button
              className={`dg-tool ${sidecarMode !== 'hidden' ? 'is-active' : ''}`}
              type="button"
              aria-pressed={sidecarMode !== 'hidden'}
              title="Show or hide the component inspector (I)"
              onClick={uiPrefs.toggleSidecar}
            >
              Inspector
            </button>
            {embedActive ? (
              <button
                className="dg-tool"
                type="button"
                disabled={exporting}
                title="Download this diagram as a PNG"
                onClick={() => void downloadPng()}
              >
                {exporting ? 'Exporting…' : 'Download PNG'}
              </button>
            ) : (
              <SettingsMenu
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                theme={theme}
                onToggleTheme={toggleTheme}
                spacing={spacing}
                spacingStep={SPACING_STEP}
                onSpacingChange={setSpacing}
                onReset={() => { resetLayout(); setSettingsOpen(false); }}
                exporting={exporting}
                onDownloadPng={() => void downloadPng()}
                onDownloadOffline={downloadOffline}
                ui={ui}
                onSidecarChange={uiPrefs.setSidecar}
                onToolChange={uiPrefs.setTool}
              />
            )}
          </div>
          {/*
            The board drives theme from OUTSIDE the iframe by clicking this
            exact class (sn-board-astro/public/js/canvas-page.mjs), so it must
            stay in the DOM even though the visible control now lives in the
            settings menu. Folding it into the dropdown would leave the host's
            Theme button present and silently inert.
          */}
          <button
            className="dg-theme-toggle dg-theme-toggle-host"
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (D)`}
            onClick={toggleTheme}
          >
            <ThemeGlyph theme={theme} />
          </button>
        </div>
      </header>
      )}

      <div
        className={`dg-body ${embedActive ? 'is-embed' : ''}`}
        style={{ '--dg-side-w': sidecarMode === 'right' ? `${ui.sideWidth}px` : '0px' } as CSSProperties}
      >
        {!embedActive && (
          <DiagramRail
            diagrams={diagrams}
            activeIndex={activeIndex}
            collapsed={railCollapsed}
            onToggle={toggleRail}
            onSelect={switchDiagram}
          >
            {sidecarMode === 'left' && !railCollapsed && (
              <div className="dg-rail-inspector">{inspector}</div>
            )}
          </DiagramRail>
        )}
        <section
          ref={canvasRef}
          className={`dg-canvas dg-dialect-${diagram.dialect} ${editMode ? 'is-editing' : ''}`}
          style={{ '--dg-text-scale': String(textScale) } as CSSProperties}
          aria-label={`${diagram.title} architecture diagram`}
        >
          <EdgeRoutesProvider>
            <ReactFlow<DiagramFlowNode, DiagramFlowEdge>
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.1 }}
              minZoom={0.15}
              maxZoom={2}
              nodesDraggable={editMode}
              nodesConnectable={false}
              edgesFocusable={editMode}
              elementsSelectable={editMode}
              selectionOnDrag={editMode}
              selectionMode={SelectionMode.Partial}
              panOnDrag={editMode ? [1, 2] : true}
              multiSelectionKeyCode="Shift"
              deleteKeyCode={null}
              disableKeyboardA11y
              onlyRenderVisibleElements={false}
              colorMode={theme}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={clearSelection}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1.4}
                color="var(--dg-canvas-dots)"
              />
              {(toolVisible('zoom') || toolVisible('lock')) && (
                <Controls
                  position="top-left"
                  // Lock is advertised as its own switch, so the stack renders
                  // whenever EITHER is on and each part is gated separately —
                  // nesting lock inside the zoom gate made it unreachable with
                  // zoom off (cross-vendor review, 2026-09-15).
                  showZoom={toolVisible('zoom')}
                  showFitView={toolVisible('zoom')}
                  showInteractive={toolVisible('lock')}
                />
              )}
              {toolVisible('readout') && (
                <Panel
                  position="top-left"
                  // The controls stack owns the same corner; the readout drops
                  // below it, and moves back up when the stack is switched off.
                  className={`dg-zoom-panel ${toolVisible('zoom') || toolVisible('lock') ? 'has-controls' : ''}`}
                >
                  <ZoomReadout onReset={() => void fitView({ padding: 0.1, duration: 200 })} />
                </Panel>
              )}
              {toolVisible('minimap') && (
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-right"
                  nodeColor={minimapNodeColor}
                  nodeStrokeWidth={2}
                />
              )}
            </ReactFlow>
          </EdgeRoutesProvider>
          {editMode && (
            <StyleBar
              nodeIds={styleTargets.nodeIds}
              edgeIds={styleTargets.edgeIds}
              dialect={diagram.dialect}
              onNodeStyle={(patch) => styleEditing.applyNodeStyle(styleTargets.nodeIds, patch)}
              onEdgeStyle={(patch) => styleEditing.applyEdgeStyle(styleTargets.edgeIds, patch)}
              onClear={() => styleEditing.clearStyles(styleTargets.nodeIds, styleTargets.edgeIds)}
            />
          )}
          {editMode && (
            <div className="dg-edit-hint" aria-live="polite">
              EDIT — drag cards (clamped to their group) · drag empty canvas to lasso ·
              Shift-click adds · arrows nudge (Shift = ×4) · click a group edge to resize ·
              click a line or its label to select it · middle/right mouse pans
            </div>
          )}
        </section>

        {sidecarMode === 'right' && (
        <aside className="dg-side-rail" aria-label="Diagram information">
          <SideResizer
            width={ui.sideWidth}
            onWidth={uiPrefs.setSideWidth}
            onReset={uiPrefs.resetSideWidth}
          />
          {inspector}
        </aside>
        )}
      </div>
    </main>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <DiagramPage />
    </ReactFlowProvider>
  );
}
