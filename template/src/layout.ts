import type {
  CsdmDomain,
  DiagramDef,
  DiagramGroupDef,
  DiagramId,
  DiagramLegend,
  DiagramNodeDef,
} from './model';
import { partyLabel } from './model';

// Slide-grade baselines (raised from 24/24/84/96 after a field build whose
// default framing was rejected as "crammed" — the bar is a well-laid-out
// PowerPoint slide, not a dense schematic).
export const GAP = 30;
export const HEADER_H = 44;
export const PAD = 28;
export const ROOT_GAP = 104;

// ── Controls-and-ownership overlay ──────────────────────────────────────
// Every in-card row added by the overlay has ONE exported height constant and
// ONE row function, imported by BOTH the component that renders it and the
// layout that reserves space for it. Three literals encoding the same row is
// how 18 chips ended up painted over their own cards on the origin build.

/** Height of one control-chip row. Shared with ControlChips. */
export const CONTROL_CHIP_ROW_H = 22;
/** Height of the owner corner tag / TO CONFIRM strip inside a card. */
export const NODE_TAG_ROW_H = 20;
export const LEGEND_NODE_ID = '__legend-chrome';
export const LEGEND_COLUMNS = 3;
export const LEGEND_PAD = 24;
export const LEGEND_GAP = 24;

/** At most three tags on canvas, two per row. The single source of truth. */
export function controlChipRows(controls: string[] = []): string[][] {
  const visible = controls.slice(0, 3);
  return visible.length ? [visible.slice(0, 2), ...(visible.length > 2 ? [visible.slice(2)] : [])] : [];
}

/**
 * Width of the widest control-chip row. Exported because the edge-label
 * placer reserves space for the SAME rendered row: two independently-tuned
 * estimates of one element drift apart, which is the whole reason the
 * height constants above are shared too.
 */
export function controlChipsWidth(controls?: string[]): number {
  return controlsWidth(controls);
}

function controlsWidth(controls?: string[]): number {
  return Math.max(0, ...controlChipRows(controls).map((row) => (
    row.reduce((width, tag) => width + tag.length * 5.5 + 14, 0) + (row.length - 1) * 4
  )));
}

/**
 * A group header grows by one row when it carries an owner chip or a status
 * chip. The edge-label placer treats the SAME rect as a label obstacle, which
 * is why this is a function and not two literals.
 */
export function groupHeaderHeight(group: DiagramGroupDef): number {
  return HEADER_H + (group.owner || group.status === 'to-confirm' ? 32 : 0)
    + (group.chips?.length ? CSDM_CHIP_ROW_H : 0);
}

/**
 * Conservative text-wrapping estimate for one legend column, including the
 * analogy and "administered by" lines. `administrators` is passed in rather
 * than read from a module constant: no party name is compiled into layout.
 */
export function legendGroupHeight(
  group: DiagramLegend['groups'][number],
  width: number,
  administrators: Record<string, string>,
): number {
  const lines = (text: string, charWidth: number) => Math.max(1, Math.ceil(text.length * charWidth / Math.max(40, width)));
  return lines(group.heading, 7) * 16 + 16 + group.items.reduce((height, item) => (
    height + lines(`${item.tag} — ${item.meaning}`, 6.5) * 18
      + (item.analogy ? lines(item.analogy, 6.2) * 17 + 4 : 0)
      + (item.administeredBy.length > 0
        ? lines(`administered by ${item.administeredBy.map((party) => administrators[party] ?? party).join(' · ')}`, 6) * 14
        : 0) + 16
  ), 0);
}

/**
 * The legend is one chrome node spanning the full composition width, below
 * the root grid. Its box is a normal layout box, so the exporter's
 * crop-to-node-bounds keeps the whole legend in the PNG for free.
 */
function placeLegend(
  diagram: DiagramDef,
  boxes: Record<string, LayoutBox>,
  spacing: number,
  administrators: Record<string, string>,
): void {
  if (!diagram.legend) return;
  const roots = Object.values(boxes);
  const width = Math.max(240, ...roots.map((box) => box.x + box.width));
  const columnWidth = (width - LEGEND_PAD * 2 - LEGEND_GAP * (LEGEND_COLUMNS - 1)) / LEGEND_COLUMNS;
  const rowHeights: number[] = [];
  diagram.legend.groups.forEach((group, index) => {
    const row = Math.floor(index / LEGEND_COLUMNS);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, legendGroupHeight(group, columnWidth, administrators));
  });
  boxes[LEGEND_NODE_ID] = {
    x: 0,
    y: Math.max(0, ...roots.map((box) => box.y + box.height)) + ROOT_GAP * spacing,
    width,
    height: LEGEND_PAD * 2 + Math.max(1, Math.ceil(diagram.legend.title.length * 11 / (width - LEGEND_PAD * 2))) * 26 + 20
      + rowHeights.reduce((total, height) => total + height, 0) + Math.max(0, rowHeights.length - 1) * LEGEND_GAP,
  };
}

/** Long-form party names for the legend's "administered by" line. */
function legendAdministrators(diagram: DiagramDef): Record<string, string> {
  return {
    customer: partyLabel(diagram, 'customer', 'long'),
    supplier: partyLabel(diagram, 'supplier', 'long'),
    product: partyLabel(diagram, 'product', 'long'),
  };
}

const CARD_MIN_W = 132;
const CARD_MAX_W = 240;
const CARD_BASE_H = 82;
const EYEBROW_H = 14;
const AWS_NODE_W = 112;
const AWS_NODE_H = 78;
const ROOT_NODE_ROW_PITCH = 112;

// Pyramid dialect: centred bars widening downward, axis gutter on the left,
// in-canvas heading above. Bar widths grow monotonically by at least
// PYR_MIN_STEP per tier while always fitting their one-line text.
export const PYR_BAR_H = 58;
export const PYR_BAR_GAP = 26;
export const PYR_MIN_STEP = 96;
export const PYR_AXIS_GUTTER = 112;
export const PYR_HEADING_H = 118;

// ── lifecycle dialect ───────────────────────────────────────────────────
// Every constant below is measured from the source figure rendered at
// 300 dpi and used at 1:1, so the reproduction keeps the original's
// proportions rather than a redrawn approximation of them.

/** Notched label box on the frame's top-left corner. */
export const LC_TAB_H = 43;
export const LC_TAB_W = 330;
/** Frame inner height: title band + chevron row + feedback bus. */
export const LC_FRAME_H = 178;
/** Chevron row top, relative to the frame. */
export const LC_STAGE_TOP = 48;
export const LC_STAGE_H = 50;
/** Depth of the chevron's right-hand point, measured at mid-height. */
export const LC_STAGE_POINT = 18;
/** White space between one chevron's point and the next chevron's flat edge. */
export const LC_STAGE_GAP = 9;
/** Frame inset before the first chevron and after the last. */
export const LC_STAGE_INSET_L = 27;
export const LC_STAGE_INSET_R = 20;
/** First chevron is narrower than the rest in the source figure. */
export const LC_STAGE_W_FIRST = 322;
export const LC_STAGE_W = 348;
/** Shared horizontal rail every feedback arrow runs along, frame-relative. */
export const LC_BUS_Y = 144;
/** Sideways offset when one stage both sends and receives feedback. */
export const LC_BUS_SPLIT = 88;
/** Full-width substrate band under the frame. */
export const LC_BAND_H = 54;

export const LIFECYCLE_CHROME_ID = '__lifecycle-chrome';
const PYR_CHAR_W = 8.4;
const PYR_BAR_PAD = 64;

// ── csdm dialect (the CSDM domain quilt) ────────────────────────────────
// Slots are fractions of a working width, never pixels: the quilt grows to
// fit its own text and the arrangement survives a longer label.

/** Working width at 1x spacing; every slot below is a fraction of it. */
export const CSDM_BASE_W = 1720;
/** Each of the two region columns. */
export const CSDM_REGION_FRACTION = 0.42;
/** Diameter of the Manage Portfolio hub. */
export const CSDM_HUB_FRACTION = 0.18;
/** Role-figure gutter column beside a region. */
export const CSDM_GUTTER_W = 150;
export const CSDM_GUTTER_GAP = 22;
/** Height of a role figure (glyph + up to two label lines). */
export const CSDM_FIGURE_H = 58;
/**
 * The workflow-chip tile row, drawn INSIDE the region header band. One
 * constant, read by `groupHeaderHeight` (which reserves it), by CsdmRegion
 * (which paints it) and, through the header band, by the edge-label placer.
 */
export const CSDM_CHIP_ROW_H = 74;
/** Offset of the two ghost layers behind a `stack` card, inside its box. */
export const CSDM_STACK_PAD = 11;
/** Outer corner radius of a quilt patch; the corner facing the hub is square. */
export const CSDM_REGION_RADIUS = 32;
const CSDM_CARD_MIN_W = 138;
const CSDM_CARD_MAX_W = 244;
const CSDM_CARD_MIN_H = 76;
const CSDM_SUB_TOP_GAP = 6;
/** Widest a spread column gap may grow, as a multiple of GAP. */
const CSDM_SPREAD_MAX = 3;

/**
 * Per-diagram default spacing multiplier, applied as the INITIAL spacing value
 * only when no user override exists (localStorage / injected offline state).
 * Populate during the layout-tuning probe for any composition that still reads
 * cramped at 1x; everything omitted keeps the plain 1x default. Typical values
 * are 1.1-1.3 — beyond that, fix the col/row hints instead.
 */
export const DEFAULT_SPACING: Partial<Record<DiagramId, number>> = {};

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramLayout {
  boxes: Record<string, LayoutBox>;
  groupDepths: Record<string, number>;
}

interface SizedItem {
  id: string;
  col: number;
  row: number;
  width: number;
  height: number;
  group?: DiagramGroupDef;
  node?: DiagramNodeDef;
}

interface GridMetrics {
  colOffsets: number[];
  rowOffsets: number[];
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cardWidth(node: DiagramNodeDef): number {
  const titleWidth = node.title.length * 7.2;
  const eyebrowWidth = (node.eyebrow?.length ?? 0) * 5.8;
  const subtitleWidth = Math.min(node.subtitle?.length ?? 0, 30) * 5.4;
  return Math.ceil(clamp(
    Math.max(titleWidth, eyebrowWidth, subtitleWidth) + 28,
    CARD_MIN_W,
    CARD_MAX_W,
  ));
}

/**
 * The box is AUTHORED GEOMETRY, measured from the unscaled string and from the
 * fixed-size chrome rows a card carries. It deliberately does NOT track the
 * text scale: raising the type size grows the type inside this box and is
 * expected to overflow it, the way text in a PowerPoint shape overflows the
 * shape rather than resizing it. Scaling lives entirely in CSS.
 */
export function measureDiagramNode(
  node: DiagramNodeDef,
  dialect: DiagramDef['dialect'],
): Pick<LayoutBox, 'width' | 'height'> {
  const extraHeight = controlChipRows(node.controls).length * CONTROL_CHIP_ROW_H
    + (node.owner ? NODE_TAG_ROW_H : 0) + (node.status === 'to-confirm' ? NODE_TAG_ROW_H : 0);
  if (dialect === 'aws') {
    return {
      width: Math.max(AWS_NODE_W, controlsWidth(node.controls) + 8),
      height: AWS_NODE_H + extraHeight + (node.status === 'to-confirm' ? 4 : 0),
    };
  }

  return {
    width: Math.max(cardWidth(node), controlsWidth(node.controls) + 32),
    height: CARD_BASE_H + (node.eyebrow ? EYEBROW_H : 0) + extraHeight,
  };
}

function gridMetrics(items: SizedItem[], gap: number): GridMetrics {
  if (items.length === 0) {
    return { colOffsets: [0], rowOffsets: [0], width: 0, height: 0 };
  }

  const columnCount = Math.max(...items.map((item) => item.col)) + 1;
  const rowCount = Math.max(...items.map((item) => item.row)) + 1;
  const columnWidths = Array.from({ length: columnCount }, () => 0);
  const rowHeights = Array.from({ length: rowCount }, () => 0);

  items.forEach((item) => {
    columnWidths[item.col] = Math.max(columnWidths[item.col], item.width);
    rowHeights[item.row] = Math.max(rowHeights[item.row], item.height);
  });

  const offsets = (sizes: number[]) => sizes.map((_, index) => (
    sizes.slice(0, index).reduce((sum, size) => sum + size, 0) + gap * index
  ));

  return {
    colOffsets: offsets(columnWidths),
    rowOffsets: offsets(rowHeights),
    width: columnWidths.reduce((sum, width) => sum + width, 0)
      + gap * Math.max(0, columnCount - 1),
    height: rowHeights.reduce((sum, height) => sum + height, 0)
      + gap * Math.max(0, rowCount - 1),
  };
}

/**
 * Resolves every authored row/column hint into a stable, absolute React Flow
 * rectangle. Group sizes are calculated bottom-up; placement is top-down.
 * `spacing` scales every gap/pad/pitch uniformly (1 = authored default) so
 * the whole composition breathes without losing its structure.
 */
/**
 * Pyramid dialect layout: nodes sorted by authored row, one bar per tier.
 * Bars are centred on the widest (bottom) tier, offset right of the axis
 * gutter and below the heading band. Groups/edges take no part.
 */
function computePyramidLayout(diagram: DiagramDef, spacing: number): DiagramLayout {
  const boxes: Record<string, LayoutBox> = {};
  const gap = PYR_BAR_GAP * spacing;
  const barH = PYR_BAR_H;
  const tiers = [...diagram.nodes].sort((a, b) => a.row - b.row);

  const widths: number[] = [];
  tiers.forEach((node, index) => {
    const textLen = node.title.length + 3 + (node.subtitle?.length ?? 0);
    const natural = Math.ceil(textLen * PYR_CHAR_W + PYR_BAR_PAD);
    widths.push(index === 0 ? natural : Math.max(natural, widths[index - 1] + PYR_MIN_STEP));
  });
  const maxWidth = widths[widths.length - 1] ?? 0;

  tiers.forEach((node, index) => {
    boxes[node.id] = {
      x: PYR_AXIS_GUTTER + (maxWidth - widths[index]) / 2,
      y: PYR_HEADING_H + index * (barH + gap),
      width: widths[index],
      height: barH,
    };
  });

  placeLegend(diagram, boxes, spacing, legendAdministrators(diagram));
  // The pyramid renders its LEGEND but nothing else from the overlay: its bars
  // are a fixed height with no room for a chip. Silence about that is a trap,
  // so say it once, in dev, rather than dropping the fields without a word.
  if (import.meta.env.DEV) {
    const ignored = diagram.nodes.filter((node) => node.owner || node.status === 'to-confirm' || node.controls?.length);
    if (ignored.length > 0) {
      console.warn(`[arc-diagram] ${diagram.id}: the pyramid dialect renders no owner, status or control fields — ${ignored.length} node(s) set them and they will not be drawn (${ignored.map((node) => node.id).join(', ')}). Put the ownership story on an editorial or aws view; the legend does render.`);
    }
  }
  return { boxes, groupDepths: {} };
}

// ── csdm dialect layout ─────────────────────────────────────────────────

interface CsdmPlan {
  /** Uniform entity-card size for every card in this region, sub-boxes included. */
  cardW: number;
  cardH: number;
  headerH: number;
  /** Direct-child grid offsets, relative to the region's content origin. */
  colOffsets: number[];
  rowOffsets: number[];
  colWidths: number[];
  rowHeights: number[];
  innerW: number;
  innerH: number;
  /** Height of the role row under the cards ('below' gutter), 0 when unused. */
  figureRowH: number;
  /** Sub-box rectangles, relative to the region's content origin. */
  subBoxes: Record<string, LayoutBox>;
  width: number;
  height: number;
}

/** Every entity card inside a region, including those in its sub-boxes. */
function csdmRegionCards(diagram: DiagramDef, regionId: string): DiagramNodeDef[] {
  const ids = new Set([regionId]);
  let grew = true;
  while (grew) {
    grew = false;
    diagram.groups.forEach((group) => {
      if (group.parent && ids.has(group.parent) && !ids.has(group.id)) {
        ids.add(group.id);
        grew = true;
      }
    });
  }
  return diagram.nodes.filter((node) => node.group && ids.has(node.group) && !node.figure);
}

/**
 * One region's geometry at a given uniform card size. Called twice: once with
 * the natural card size to learn how wide the quilt has to be, once with the
 * card size that fills the settled column width. No pixel is hand-placed —
 * every number here is derived from measured text.
 */
function csdmPlanRegion(
  diagram: DiagramDef,
  group: DiagramGroupDef,
  cardW: number,
  cardH: number,
  gap: number,
  pad: number,
  /** Column gap, which the fill pass widens to spread capped cards across a
   *  patch instead of clustering them at its left edge. Rows keep `gap`. */
  colGap: number = gap,
): CsdmPlan {
  const headerH = groupHeaderHeight(group);
  const subs = diagram.groups.filter((candidate) => candidate.parent === group.id);
  const directCards = diagram.nodes.filter((node) => node.group === group.id && !node.figure);
  const figures = diagram.nodes.filter((node) => node.group === group.id && node.figure);
  const belowFigures = figures.filter((node) => node.gutter === 'below');

  const columnCount = Math.max(
    1,
    ...directCards.map((node) => node.col + 1),
    ...subs.map((sub) => sub.col + 1),
  );
  const rowCount = Math.max(
    1,
    ...directCards.map((node) => node.row + 1),
    ...subs.map((sub) => sub.row + 1),
  );
  // Cards are uniform inside a region, so a column is one card wide until a
  // sub-box needs more. A column nobody occupies still holds a card's width,
  // which keeps the grid honest when a row skips a slot.
  const colWidths = Array.from({ length: columnCount }, () => cardW);
  const rowHeights = Array.from({ length: rowCount }, () => 0);
  directCards.forEach((node) => {
    rowHeights[node.row] = Math.max(rowHeights[node.row], cardH);
  });

  // A sub-box SPANS from its own column to the end of the grid, the way the
  // source draws it: a band under the cards, not a wide cell that shoves its
  // row-mates sideways. It only widens the grid when its own content cannot
  // fit the span.
  const subPlans = new Map<string, CsdmPlan>();
  subs.forEach((sub) => {
    const plan = csdmPlanRegion(diagram, sub, cardW, cardH, gap, pad, gap);
    subPlans.set(sub.id, plan);
    const span = colWidths.slice(sub.col).reduce((sum, width) => sum + width, 0)
      + colGap * Math.max(0, columnCount - sub.col - 1);
    if (plan.width > span) colWidths[columnCount - 1] += plan.width - span;
    rowHeights[sub.row] = Math.max(rowHeights[sub.row], plan.height);
  });

  const offsets = (sizes: number[], step: number) => sizes.map((_, index) => (
    sizes.slice(0, index).reduce((sum, size) => sum + size, 0) + step * index
  ));
  const colOffsets = offsets(colWidths, colGap);
  const rowOffsets = offsets(rowHeights, gap);
  const innerW = colWidths.reduce((sum, width) => sum + width, 0) + colGap * Math.max(0, columnCount - 1);
  const innerH = rowHeights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, rowCount - 1);
  const figureRowH = belowFigures.length ? gap + CSDM_FIGURE_H : 0;

  const subBoxes: Record<string, LayoutBox> = {};
  subs.forEach((sub) => {
    subBoxes[sub.id] = {
      x: colOffsets[sub.col],
      y: rowOffsets[sub.row],
      width: innerW - colOffsets[sub.col],
      height: subPlans.get(sub.id)!.height,
    };
  });

  // A gutter figure may name a row the cards never reach (three role figures
  // beside two card rows). The patch has to grow to hold it, or the figure
  // hangs off the bottom of its own region.
  const gutterExtent = Math.max(0, ...figures
    .filter((node) => node.gutter !== 'below')
    .map((node) => {
      if (node.row < rowCount) return rowOffsets[node.row] + rowHeights[node.row];
      const last = rowCount - 1;
      const base = rowOffsets[last] + rowHeights[last];
      return base + gap + (node.row - last - 1) * (cardH + gap) + cardH;
    }));

  return {
    cardW,
    cardH,
    headerH,
    colOffsets,
    rowOffsets,
    colWidths,
    rowHeights,
    innerW,
    innerH,
    figureRowH,
    subBoxes,
    width: innerW + pad * 2,
    height: headerH + CSDM_SUB_TOP_GAP
      + Math.max(innerH + figureRowH, gutterExtent) + pad,
  };
}

/** Natural (text-fitting) uniform card size for one region. */
function csdmNaturalCard(
  diagram: DiagramDef,
  regionId: string,
): { width: number; height: number } {
  const cards = csdmRegionCards(diagram, regionId);
  if (cards.length === 0) {
    return { width: CSDM_CARD_MIN_W, height: CSDM_CARD_MIN_H };
  }
  const stackPad = cards.some((card) => card.stack) ? CSDM_STACK_PAD : 0;
  const measured = cards.map((card) => measureDiagramNode(card, 'csdm'));
  return {
    width: clamp(
      Math.max(...measured.map((size) => size.width)) + stackPad,
      CSDM_CARD_MIN_W,
      CSDM_CARD_MAX_W + stackPad,
    ),
    height: Math.max(
      CSDM_CARD_MIN_H,
      Math.max(...measured.map((size) => size.height)) + stackPad,
    ),
  };
}

/**
 * The quilt. Six domain regions in a fixed arrangement around a white hub,
 * a full-width foundation strip beneath, role figures in the gutters. The
 * ARRANGEMENT is fixed; every SIZE is derived from the content, so a longer
 * label widens the quilt instead of overflowing a patch.
 */
function computeCsdmLayout(
  diagram: DiagramDef,
  spacing: number,
): DiagramLayout {
  // Gaps follow SPACING only, deliberately.
  const gap = GAP * spacing;
  const pad = PAD * spacing;
  const vGap = 96 * spacing;
  const bandGap = 30 * spacing;
  const gutterGap = CSDM_GUTTER_GAP * spacing;
  const boxes: Record<string, LayoutBox> = {};
  const groupDepths: Record<string, number> = {};

  const byDomain = new Map(
    diagram.groups.filter((group) => group.domain).map((group) => [group.domain!, group]),
  );
  const quiltDomains: CsdmDomain[] = ['build', 'design', 'ideation', 'delivery', 'consumption'];

  // Pass 1 — natural sizes, to learn how wide the quilt must be.
  const cardSizes = new Map<string, { width: number; height: number }>();
  const naturalWidth = (domain: CsdmDomain): number => {
    const group = byDomain.get(domain);
    if (!group) return 0;
    const card = csdmNaturalCard(diagram, group.id);
    cardSizes.set(group.id, card);
    return csdmPlanRegion(diagram, group, card.width, card.height, gap, pad, gap).width;
  };
  const columnContent = Math.max(0, ...quiltDomains.map(naturalWidth));
  const foundationGroup = byDomain.get('foundation');
  const foundationNatural = foundationGroup ? naturalWidth('foundation') : 0;

  const hubDiameter = CSDM_HUB_FRACTION * CSDM_BASE_W;
  const columnGap = Math.max(
    CSDM_BASE_W * (1 - CSDM_REGION_FRACTION * 2),
    hubDiameter + 34 * spacing,
  );
  let columnW = Math.max(CSDM_REGION_FRACTION * CSDM_BASE_W, columnContent);
  let quiltW = columnW * 2 + columnGap;
  if (foundationNatural > quiltW) {
    columnW += (foundationNatural - quiltW) / 2;
    quiltW = foundationNatural;
  }

  // Pass 2 — settled widths: grow the uniform card so the region fills its patch.
  const plans = new Map<string, CsdmPlan>();
  /**
   * Fill a patch of a known width. The uniform card grows first, up to the
   * card cap; whatever slack the cap leaves is spread across the column gaps,
   * up to CSDM_SPREAD_MAX gaps, so cards sit across their patch rather than
   * huddling at its left edge. Both terms are derived from measured text — no
   * step of this is a hand-placed pixel.
   */
  const fillPlan = (
    group: DiagramGroupDef,
    boxWidth: number,
    fixedCard?: { width: number; height: number },
  ): CsdmPlan => {
    const natural = fixedCard
      ?? cardSizes.get(group.id)
      ?? csdmNaturalCard(diagram, group.id);
    const first = csdmPlanRegion(diagram, group, natural.width, natural.height, gap, pad, gap);
    const columns = Math.max(1, first.colWidths.length);
    const slack = boxWidth - pad * 2 - first.innerW;
    const maxCap = CSDM_CARD_MAX_W + CSDM_STACK_PAD;
    const cardW = fixedCard || slack <= 0
      ? natural.width
      : Math.min(maxCap, natural.width + slack / columns);
    const second = csdmPlanRegion(diagram, group, cardW, natural.height, gap, pad, gap);
    const remaining = boxWidth - pad * 2 - second.innerW;
    const colGap = columns > 1 && remaining > 0
      ? Math.min(gap * CSDM_SPREAD_MAX, gap + remaining / (columns - 1))
      : gap;
    const plan = csdmPlanRegion(diagram, group, cardW, natural.height, gap, pad, colGap);
    plans.set(group.id, plan);
    return plan;
  };
  const planAt = fillPlan;

  const build = byDomain.get('build');
  const design = byDomain.get('design');
  const ideation = byDomain.get('ideation');
  const delivery = byDomain.get('delivery');
  const consumption = byDomain.get('consumption');
  const portfolio = byDomain.get('portfolio');

  const buildPlan = build && planAt(build, columnW);
  const designPlan = design && planAt(design, columnW);
  const ideationPlan = ideation && planAt(ideation, columnW);
  const deliveryPlan = delivery && planAt(delivery, columnW);
  const consumptionPlan = consumption && planAt(consumption, columnW);
  const foundationPlan = foundationGroup && planAt(foundationGroup, quiltW);

  const hasLeftGutter = diagram.nodes.some((node) => node.figure && node.gutter === 'left');
  const originX = hasLeftGutter ? CSDM_GUTTER_W + gutterGap : 0;
  const leftX = originX;
  const rightX = originX + columnW + columnGap;

  const topH = Math.max(buildPlan?.height ?? 0, designPlan?.height ?? 0);
  const lowerY = topH + vGap;
  const ideationH = ideationPlan?.height ?? 0;
  const rightLowerH = ideationH + bandGap + (consumptionPlan?.height ?? 0);
  const deliveryH = Math.max(deliveryPlan?.height ?? 0, rightLowerH);
  const consumptionY = lowerY + ideationH + bandGap;
  const consumptionH = deliveryH - ideationH - bandGap;
  const foundationY = lowerY + deliveryH + vGap;

  const place = (group: DiagramGroupDef | undefined, box: LayoutBox) => {
    if (!group) return;
    boxes[group.id] = box;
    groupDepths[group.id] = 0;
  };
  place(build, { x: leftX, y: 0, width: columnW, height: topH });
  place(design, { x: rightX, y: 0, width: columnW, height: topH });
  place(ideation, { x: rightX, y: lowerY, width: columnW, height: ideationH });
  place(delivery, { x: leftX, y: lowerY, width: columnW, height: deliveryH });
  place(consumption, { x: rightX, y: consumptionY, width: columnW, height: consumptionH });
  place(foundationGroup, {
    x: leftX, y: foundationY, width: quiltW, height: foundationPlan?.height ?? 0,
  });
  if (portfolio) {
    boxes[portfolio.id] = {
      x: leftX + columnW + (columnGap - hubDiameter) / 2,
      y: topH + vGap / 2 - hubDiameter / 2,
      width: hubDiameter,
      height: hubDiameter,
    };
    groupDepths[portfolio.id] = 0;
  }

  /** Row offset inside a region, extended past the authored grid for a gutter
   *  figure whose row hint names a row the cards never reach. */
  const rowOffsetAt = (plan: CsdmPlan, row: number): { offset: number; height: number } => {
    if (row < plan.rowOffsets.length) {
      return { offset: plan.rowOffsets[row], height: plan.rowHeights[row] };
    }
    const last = plan.rowOffsets.length - 1;
    const base = last >= 0 ? plan.rowOffsets[last] + plan.rowHeights[last] : 0;
    return {
      offset: base + gap + (row - last - 1) * (plan.cardH + gap),
      height: plan.cardH,
    };
  };

  const placeChildren = (group: DiagramGroupDef, depth: number): void => {
    const plan = plans.get(group.id) ?? csdmPlanRegion(
      diagram,
      group,
      cardSizes.get(group.id)?.width ?? CSDM_CARD_MIN_W,
      cardSizes.get(group.id)?.height ?? CSDM_CARD_MIN_H,
      gap,
      pad,
    );
    const box = boxes[group.id];
    const contentX = box.x + pad;
    const contentY = box.y + plan.headerH + CSDM_SUB_TOP_GAP;

    diagram.nodes
      .filter((node) => node.group === group.id && !node.figure)
      .forEach((node) => {
        boxes[node.id] = {
          x: contentX + plan.colOffsets[node.col],
          y: contentY + plan.rowOffsets[node.row],
          width: plan.cardW,
          height: plan.cardH,
        };
      });

    diagram.groups
      .filter((sub) => sub.parent === group.id)
      .forEach((sub) => {
        const span = plan.subBoxes[sub.id];
        const subPlan = fillPlan(sub, span.width, { width: plan.cardW, height: plan.cardH });
        boxes[sub.id] = {
          x: contentX + span.x,
          y: contentY + span.y,
          width: span.width,
          height: span.height,
        };
        groupDepths[sub.id] = depth + 1;
        placeChildren(sub, depth + 1);
      });

    diagram.nodes
      .filter((node) => node.group === group.id && node.figure)
      .forEach((node) => {
        if (node.gutter === 'below') {
          boxes[node.id] = {
            x: contentX + (plan.colOffsets[node.col] ?? 0),
            y: contentY + plan.innerH + gap,
            width: Math.max(CSDM_GUTTER_W, plan.cardW),
            height: CSDM_FIGURE_H,
          };
          return;
        }
        const row = rowOffsetAt(plan, node.row);
        boxes[node.id] = {
          x: node.gutter === 'right'
            ? box.x + box.width + gutterGap
            : box.x - gutterGap - CSDM_GUTTER_W,
          y: contentY + row.offset + (row.height - CSDM_FIGURE_H) / 2,
          width: CSDM_GUTTER_W,
          height: CSDM_FIGURE_H,
        };
      });
  };

  diagram.groups
    .filter((group) => group.domain && group.domain !== 'portfolio')
    .forEach((group) => placeChildren(group, 0));

  placeLegend(diagram, boxes, spacing, legendAdministrators(diagram));
  return { boxes, groupDepths };
}

/**
 * lifecycle dialect layout: stages are chevrons on one row inside a frame,
 * substrates are full-width bands stacked beneath it. The chrome node carries
 * the frame, its corner tab and its centred title, and spans the whole frame
 * including the tab above it. Widths come from the source figure; `spacing`
 * scales the pipeline horizontally without disturbing the chevron proportions.
 */
function computeLifecycleLayout(diagram: DiagramDef, spacing: number): DiagramLayout {
  const boxes: Record<string, LayoutBox> = {};
  const stages = diagram.nodes
    .filter((node) => (node.lifecycleRole ?? 'stage') === 'stage')
    .sort((a, b) => a.col - b.col);
  const substrates = diagram.nodes
    .filter((node) => node.lifecycleRole === 'substrate')
    .sort((a, b) => a.row - b.row);

  const gap = LC_STAGE_GAP * spacing;
  const widths = stages.map((node, index) => (
    (index === 0 ? LC_STAGE_W_FIRST : LC_STAGE_W) * spacing
  ));
  const pipelineWidth = widths.reduce((sum, width) => sum + width, 0)
    + gap * Math.max(0, widths.length - 1);
  const frameWidth = LC_STAGE_INSET_L * spacing + pipelineWidth + LC_STAGE_INSET_R * spacing;

  let x = LC_STAGE_INSET_L * spacing;
  stages.forEach((node, index) => {
    boxes[node.id] = {
      x,
      y: LC_TAB_H + LC_STAGE_TOP,
      width: widths[index],
      height: LC_STAGE_H,
    };
    x += widths[index] + gap;
  });

  substrates.forEach((node, index) => {
    boxes[node.id] = {
      x: 0,
      y: LC_TAB_H + LC_FRAME_H + index * LC_BAND_H,
      width: frameWidth,
      height: LC_BAND_H,
    };
  });

  boxes[LIFECYCLE_CHROME_ID] = {
    x: 0,
    y: 0,
    width: frameWidth,
    height: LC_TAB_H + LC_FRAME_H,
  };

  placeLegend(diagram, boxes, spacing, legendAdministrators(diagram));
  return { boxes, groupDepths: {} };
}

export function computeDiagramLayout(
  diagram: DiagramDef,
  spacing = 1,
): DiagramLayout {
  if (diagram.dialect === 'lifecycle') return computeLifecycleLayout(diagram, spacing);
  if (diagram.dialect === 'pyramid') return computePyramidLayout(diagram, spacing);
  if (diagram.dialect === 'csdm') return computeCsdmLayout(diagram, spacing);
  const gap = GAP * spacing;
  const pad = PAD * spacing;
  const rootPitch = ROOT_NODE_ROW_PITCH * spacing;
  const boxes: Record<string, LayoutBox> = {};
  const groupDepths: Record<string, number> = {};
  const groupsById = new Map(diagram.groups.map((group) => [group.id, group]));
  const groupSizes = new Map<string, Pick<LayoutBox, 'width' | 'height'>>();

  const directItems = (parent?: string): SizedItem[] => [
    ...diagram.groups
      .filter((group) => group.parent === parent)
      .map((group) => {
        const size = sizeGroup(group);
        return { id: group.id, col: group.col, row: group.row, ...size, group };
      }),
    ...diagram.nodes
      .filter((node) => node.group === parent)
      .map((node) => ({
        id: node.id,
        col: node.col,
        row: node.row,
        ...measureDiagramNode(node, diagram.dialect),
        node,
      })),
  ];

  function sizeGroup(group: DiagramGroupDef): Pick<LayoutBox, 'width' | 'height'> {
    const cached = groupSizes.get(group.id);
    if (cached) return cached;

    const children = directItems(group.id);
    const grid = gridMetrics(children, gap);
    const size = {
      // The header row grows for an owner/status chip, and the chips need
      // room beside the title: both are measured, never assumed.
      width: Math.max(240, grid.width + pad * 2,
        group.owner || group.status === 'to-confirm'
          ? (group.owner?.label.length ?? 0) * 6.2 + (group.chip?.length ?? 0) * 6.2
            + (group.status === 'to-confirm' ? 90 : 0) + 90
          : 0),
      height: Math.max(140, grid.height + groupHeaderHeight(group) + pad * 2),
    };
    groupSizes.set(group.id, size);
    return size;
  }

  function placeGroup(group: DiagramGroupDef, x: number, y: number, depth: number): void {
    const size = sizeGroup(group);
    boxes[group.id] = { x, y, ...size };
    groupDepths[group.id] = depth;

    const children = directItems(group.id);
    const grid = gridMetrics(children, gap);
    children.forEach((child) => {
      const childX = x + pad + grid.colOffsets[child.col];
      const childY = y + groupHeaderHeight(group) + pad + grid.rowOffsets[child.row];
      if (child.group) {
        placeGroup(child.group, childX, childY, depth + 1);
      } else {
        boxes[child.id] = {
          x: childX,
          y: childY,
          width: child.width,
          height: child.height,
        };
      }
    });
  }

  const roots = directItems(undefined);
  const rootGrid = gridMetrics(
    roots,
    (diagram.rootColGap ?? ROOT_GAP) * spacing,
  );
  const rootGroups = roots.filter((root) => root.group);
  const rootGroupGrid = gridMetrics(rootGroups, ROOT_GAP * spacing);
  const canvasNodes = roots.filter((root) => root.node);
  // The authored pitch is the rhythm and stays the floor; a row only breaks
  // it when its tallest card would actually reach into the next row. Cards
  // can now grow (owner tag, chip rows, status strip), and a fixed pitch let
  // a grown card overlap its neighbour below. Expanding on `height > pitch`
  // rather than `height + gap > pitch` is what keeps pre-overlay compositions
  // where they were at the default spacing — the optional-fields-only
  // invariant, enforced by `npm run cmp:baseline`.
  // Exact scope, so the claim is not wider than the truth: `rootPitch` is
  // SCALED by `spacing`, so below 1.0 a card can exceed the pitch on its own.
  // At spacing 0.8 the pitch is 89.6 and an eyebrow card is 96 tall — under
  // the old fixed pitch those two rows OVERLAPPED by 6.4px, and this row now
  // expands instead. That is a fix, not a regression, and it is the only
  // condition under which a diagram with no overlay fields moves at all.
  const canvasRowHeights: number[] = [];
  canvasNodes.forEach((node) => {
    canvasRowHeights[node.row] = Math.max(canvasRowHeights[node.row] ?? 0, node.height);
  });
  // A row sits at its authored pitch unless a row ABOVE it is tall enough to
  // reach it. Written as a running maximum over every previous row, not as a
  // per-step sum: a sum that only inspects the immediately-next row cannot
  // push a row past a GAP in the authored numbering, so a tall row 0 with an
  // empty row 1 would overlap an occupied row 2.
  // A row sits at its authored pitch unless a row ABOVE it actually reaches
  // it. Two things this must get right, both field-caught: a row that FITS
  // its pitch never moves anything (that is the optional-fields-only
  // invariant), and a row that overruns must push every row it reaches even
  // across a GAP in the authored numbering — checking only the immediately
  // next index cannot do that.
  const rowYCache = new Map<number, number>();
  const canvasRowY = (row: number): number => {
    const cached = rowYCache.get(row);
    if (cached !== undefined) return cached;
    const authored = row * rootPitch;
    let y = authored;
    for (let index = 0; index < row; index += 1) {
      const height = canvasRowHeights[index] ?? 0;
      if (height === 0) continue;
      const bottom = canvasRowY(index) + height;
      if (bottom > authored) y = Math.max(y, bottom + gap);
    }
    rowYCache.set(row, y);
    return y;
  };
  const canvasNodeBottom = canvasNodes.reduce((bottom, node) => Math.max(
    bottom,
    canvasRowY(node.row) + node.height,
  ), 0);

  roots.forEach((root) => {
    const x = rootGrid.colOffsets[root.col];
    if (root.group) {
      const authoredRowY = rootGroupGrid.rowOffsets[root.row] ?? 0;
      const y = root.row === 0
        ? authoredRowY
        : Math.max(authoredRowY, canvasNodeBottom + gap);
      placeGroup(root.group, x, y, 0);
    } else {
      const y = canvasRowY(root.row);
      boxes[root.id] = { x, y, width: root.width, height: root.height };
    }
  });

  // Fixed inputs should always satisfy these references. Keeping the lookup
  // explicit makes a missing parent fail visibly instead of silently drifting.
  diagram.groups.forEach((group) => {
    if (group.parent && !groupsById.has(group.parent)) {
      throw new Error(`Unknown parent group: ${group.parent}`);
    }
  });

  placeLegend(diagram, boxes, spacing, legendAdministrators(diagram));
  return { boxes, groupDepths };
}
