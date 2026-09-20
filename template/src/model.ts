/**
 * Fixed data contract for the diagram set.
 * Authored by the orchestrating session; the interactive layer consumes it.
 * Content changes happen in data/*.ts, never by widening these types ad hoc.
 */

/** Free-form diagram id — used for tab identity and the tuning-map keys. */
export type DiagramId = string;

/**
 * Visual dialect. 'editorial' = Figma color-block board with floating
 * boundary-intersection edges (the system/application look). 'aws' = AWS
 * reference-architecture genre: square containment, uniform glyph tiles,
 * fixed-handle edges, numbered step circles + narrative rail. 'pyramid' =
 * gradient/hierarchy genre: centred horizontal bars widening downward with a
 * dark-to-light color ramp, an in-canvas heading, and a vertical axis arrow
 * on the left. Nodes only (row = tier, top = 0); groups and edges are
 * ignored. Node title renders as the bold lead, subtitle as the
 * " · "-separated facts line.
 */
export type DiagramDialect = 'csdm' | 'editorial' | 'aws' | 'pyramid' | 'lifecycle';

/**
 * lifecycle dialect: one stage in the left-to-right chevron pipeline
 * ('stage', row 0, ordered by col), or a full-width substrate band beneath
 * the frame ('substrate', row >= 1, one band per row). Absent = 'stage'.
 */
export type LifecycleRole = 'stage' | 'substrate';

/**
 * csdm dialect: which CSDM domain a group is. The domain fixes BOTH the
 * group's slot in the quilt and its fill colour — the one dialect where
 * region colour is semantic rather than editorial. A group with a `parent`
 * and no `domain` is a sub-box inset inside its parent region.
 */
export type CsdmDomain =
  | 'build'
  | 'design'
  | 'ideation'
  | 'portfolio'
  | 'delivery'
  | 'consumption'
  | 'foundation';

/** csdm dialect: the small pictogram drawn in a region's header. */
export type CsdmIcon =
  | 'diamond'
  | 'bulb'
  | 'spanner'
  | 'monitor'
  | 'briefcase'
  | 'building'
  | 'stairs';

/** csdm dialect: entity-card silhouette. Default 'card'. */
export type CsdmShape = 'card' | 'cloud' | 'chevron';

/**
 * Which party owns a box or tile. Rendered as ink/border treatment only —
 * ownership never spends a fill colour, which the palette already uses for
 * diagram emphasis.
 */
export type OwnerParty = 'customer' | 'supplier';

/**
 * Confirmation status. 'to-confirm' renders a dashed border + a TO CONFIRM
 * chip, on EVERY view the component appears in. A tile whose identity,
 * instance, host, mechanism or count rests on an open value is 'to-confirm';
 * a confirmed class with an unresolved sub-detail is not solid.
 */
export type ConfirmStatus = 'confirmed' | 'to-confirm';

/**
 * Who administers a control, for the legend's "administered by" line.
 * 'product' is the third value because a control can be enforced by the
 * delivered product itself rather than by either party's platform team.
 */
export type AdministeredBy = 'customer' | 'supplier' | 'product';

/** Group-level ownership: a second header chip left of `chip`. */
export interface GroupOwner {
  party: OwnerParty;
  /** Chip text, e.g. "CUSTOMER OWNS · DESKTOP PLATFORM". */
  label: string;
  /** Administering team, plain words, teams not people. Detail panel only. */
  team?: string;
}

export interface LegendItem {
  /** Control tag exactly as it appears on canvas chips, e.g. "NO BYPASS". */
  tag: string;
  /** Plain-words meaning (legend text). No citations, no identifiers. */
  meaning: string;
  /** Optional exact analogy for the audience whose seat this view is drawn at. */
  analogy?: string;
  administeredBy: AdministeredBy[];
}

export interface LegendGroup {
  /** A layer heading in plain words; the groups mirror the source document's
   *  layers, and a jointly administered control sits under the layer whose
   *  section defines it. */
  heading: string;
  items: LegendItem[];
}

export interface DiagramLegend {
  title: string;
  groups: LegendGroup[];
}

/**
 * Display names for the parties, so no customer or supplier name is ever
 * compiled into a component. `product` is required by `AdministeredBy`'s
 * third value: a two-entry lookup renders "undefined" in the legend.
 */
export interface PartyLabel {
  /** Canvas chip/tag text — short and uppercase, e.g. "ACME". */
  short: string;
  /** Legend "administered by" text — sentence case, e.g. "Acme". */
  long: string;
}

export type PartyLabels = Record<AdministeredBy, PartyLabel>;

/** Template defaults; a diagram set overrides them via `DiagramDef.parties`. */
export const DEFAULT_PARTIES: PartyLabels = {
  customer: { short: 'CUSTOMER', long: 'Customer' },
  supplier: { short: 'SUPPLIER', long: 'Supplier' },
  product: { short: 'PRODUCT', long: 'product' },
};

/**
 * The one resolver for party display names. Components never read it: the
 * graph builder resolves labels once per node and puts the strings on `data`,
 * so renderers stay data-in.
 */
export function partyLabel(
  diagram: Pick<DiagramDef, 'parties'>,
  party: AdministeredBy,
  form: 'short' | 'long',
): string {
  return (diagram.parties ?? DEFAULT_PARTIES)[party]?.[form]
    ?? DEFAULT_PARTIES[party][form];
}

export type GroupKind =
  | 'block' // Figma pastel color-block (radius 24, no border)
  | 'frame' // soft containment (surface-soft, hairline border, radius 24)
  | 'aws'; // AWS containment (square corners, black border, label top-left)

export type BlockColor =
  | 'lime'
  | 'lilac'
  | 'cream'
  | 'mint'
  | 'pink'
  | 'coral'
  | 'navy'
  | 'soft'; // surface-soft

export interface DiagramGroupDef {
  id: string;
  title: string; // rendered as mono uppercase eyebrow
  kind: GroupKind;
  color: BlockColor;
  /** Optional right-aligned count chip text, e.g. "11 COMPONENTS" */
  chip?: string;
  /** Parent group id for nesting (AWS containment; harness frame). */
  parent?: string;
  /** Layout column among sibling groups (0-based, left to right). */
  col: number;
  /** Layout row among sibling groups (0-based, top to bottom). */
  row: number;
  /** AWS lane variant: soft tint strip with dashed border. */
  lane?: boolean;
  /** Ownership chip in the header (left of `chip`). */
  owner?: GroupOwner;
  /** Default 'confirmed'. 'to-confirm' = dashed border + TO CONFIRM chip. */
  status?: ConfirmStatus;
  /** csdm only: the CSDM domain this region is — fixes its slot and colour.
   *  A group with a `parent` and no `domain` is a sub-box inside that region. */
  domain?: CsdmDomain;
  /** csdm only: small square tiles along the region's top edge (the workflow
   *  chips). They live INSIDE the header band, so `groupHeaderHeight` grows
   *  for them and the edge-label placer sees them as one obstacle. */
  chips?: string[];
  /** csdm only: corner pictogram drawn in the region header. */
  icon?: CsdmIcon;
}

export interface DiagramNodeDef {
  id: string;
  title: string;
  subtitle?: string;
  /** Mono eyebrow above the title, e.g. "SKILLS · 6" */
  eyebrow?: string;
  group?: string; // group id; ungrouped nodes are canvas-level
  col: number;
  row: number;
  /** Emphasis: 'primary' = 2px black border (the human card). */
  emphasis?: 'primary';
  /** file:line citation(s), rendered verbatim in the detail panel. */
  citations?: string[];
  /** Longer role description for the detail panel (1-3 sentences). */
  detail?: string;
  /** aws dialect only: glyph letter for the icon tile. */
  glyph?: string;
  /** aws dialect only: steps this node participates in. */
  steps?: number[];
  /**
   * Corner tag naming the owning party (rendered from `DiagramDef.parties`).
   * NOT rendered by the `pyramid` dialect, whose bars are a fixed height with
   * no room for a chip — put the ownership story on an editorial or aws view.
   * (A pyramid view's `legend` DOES render; only these node fields do not, and
   * `npm run dev` warns when a pyramid tier sets them.)
   */
  owner?: OwnerParty;
  /** Default 'confirmed'. 'to-confirm' = dashed border + TO CONFIRM chip.
   *  Not rendered by the `pyramid` dialect (see `owner`). */
  status?: ConfirmStatus;
  /** Control tags (max 3 on canvas); each must resolve to a legend item.
   *  Not rendered by the `pyramid` dialect (see `owner`). */
  controls?: string[];
  /** csdm only: two offset ghost layers behind the card (many instances). */
  stack?: boolean;
  /** csdm only: card silhouette. Default 'card'. */
  shape?: CsdmShape;
  /** csdm only: a role, drawn as a person glyph plus label in a gutter beside
   *  its region rather than as an entity card. Figures take no edges. */
  figure?: 'role';
  /** csdm only, figures only: which gutter of the group the figure sits in.
   *  'below' is the role row under the foundation strip's cards. */
  gutter?: 'left' | 'right' | 'below';
  /** lifecycle dialect: chevron stage (default) or full-width substrate band. */
  lifecycleRole?: LifecycleRole;
  /**
   * lifecycle dialect: the fill of this stage's chevron, as an explicit CSS
   * colour. Pigment normally comes from the brand, never the data — the
   * exception is a dialect whose whole job is reproducing a published figure,
   * where the source's own palette IS the specification. Only the lifecycle
   * dialect reads it.
   */
  accent?: string;
  /** lifecycle dialect: label ink over `accent`. Default 'dark'. */
  accentInk?: 'light' | 'dark';
}

export type EdgeKind =
  | 'flow' // solid, arrowhead
  | 'loop' // dashed — learning return / retry
  | 'ref'; // dashed — reference/optional

export interface DiagramEdgeDef {
  id: string;
  from: string;
  to: string;
  label?: string; // rendered as mono uppercase pill chip
  kind: EdgeKind;
  /** aws dialect only: numbered circle placed on this edge. */
  stepNo?: number;
  /** aws dialect only: 'bold' = the one emphasised arrow (heavier stroke). */
  emphasis?: 'bold';
  /** Control tags rendered as a chip row under the edge label. */
  controls?: string[];
}

export interface FlowStep {
  n: number;
  /** One sentence; **bold** component names with markdown asterisks. */
  text: string;
  /** Node ids highlighted when this step is selected. */
  nodes: string[];
  /** Edge ids highlighted when this step is selected. */
  edges: string[];
}

export interface DiagramDef {
  id: DiagramId;
  dialect: DiagramDialect;
  title: string;
  /**
   * Optional rail section heading; consecutive diagrams sharing a section
   * render under one heading; absent = flat list.
   */
  section?: string;
  /** pyramid dialect only: one-line standfirst under the in-canvas heading. */
  subtitle?: string;
  /** pyramid dialect only: rotated label on the vertical axis arrow. */
  axisLabel?: string;
  /**
   * lifecycle dialect only: the frame that contains the chevron pipeline —
   * `tab` is the notched label box on its top-left corner, `frameTitle` the
   * centred caption inside it. Both optional; omit for a bare pipeline.
   */
  tab?: string;
  frameTitle?: string;
  /**
   * Horizontal gap between root-level columns (px). Defaults to ROOT_GAP
   * (84) in layout.ts; tighten for compositions with close canvas/frame
   * columns (the system exemplar uses 48).
   */
  rootColGap?: number;
  groups: DiagramGroupDef[];
  nodes: DiagramNodeDef[];
  edges: DiagramEdgeDef[];
  /** aws dialect only. */
  steps?: FlowStep[];
  /**
   * Optional legend rendered by one non-interactive LegendChromeNode below
   * the root grid. Also the lookup table the detail panel resolves `controls`
   * tags against (flat over all groups' items). Views without their own
   * legend fall back to the one view in the set that declares one.
   */
  legend?: DiagramLegend;
  /**
   * Display names for customer / supplier / product. Set once per diagram set;
   * omitted = the neutral template defaults.
   */
  parties?: PartyLabels;
}
