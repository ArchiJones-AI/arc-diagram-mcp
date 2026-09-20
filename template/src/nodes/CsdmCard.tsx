import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DiagramLeafNode } from '../buildGraph';
import { CSDM_STACK_PAD, NODE_TAG_ROW_H } from '../layout';
import { ControlChips } from './ControlChips';
import { NodeNote } from './NodeNote';
import { CsdmRoleGlyph } from './CsdmGlyphs';

const positions = [
  ['left', Position.Left],
  ['right', Position.Right],
  ['top', Position.Top],
  ['bottom', Position.Bottom],
] as const;

function HiddenHandles() {
  return positions.flatMap(([name, position]) => [
    <Handle key={`${name}-source`} id={`${name}-source`} className="dg-handle" type="source" position={position} isConnectable={false} />,
    <Handle key={`${name}-target`} id={`${name}-target`} className="dg-handle" type="target" position={position} isConnectable={false} />,
  ]);
}

/**
 * The non-rectangular silhouettes, drawn BEHIND the label as inline SVG so
 * the label keeps the card's own text rules (two lines, no widening). Both
 * fill the card box, which layout already sized to the region's uniform card.
 */
function ShapeBackdrop({ shape }: { shape: 'cloud' | 'chevron' }) {
  if (shape === 'cloud') {
    return (
      <svg className="dg-csdm-shape" viewBox="0 0 200 110" preserveAspectRatio="none" aria-hidden="true">
        <path d="M44 100c-19 0-34-13-34-30 0-15 12-27 27-29 2-20 20-35 42-35 17 0 32 9 39 23 5-3 11-4 17-4 18 0 33 13 35 30 13 3 22 14 22 27 0 10-6 18-15 18Z" />
      </svg>
    );
  }
  return (
    <svg className="dg-csdm-shape" viewBox="0 0 200 110" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 6h160l40 49-40 49H0l40-49Z" />
    </svg>
  );
}

/**
 * A CSDM entity card, or a role figure when `figure` is set. Every piece of
 * the controls-and-ownership overlay renders exactly as the editorial card
 * renders it — owner tag, control chips, TO CONFIRM strip, embed notes — so
 * an overlay view works in this dialect with no extra fields.
 */
function CsdmCardComponent({ data }: NodeProps<DiagramLeafNode>) {
  const { def, interaction, embedMode, ownerLabel } = data;

  if (def.figure === 'role') {
    return (
      <div
        // A 'below' figure sits INSIDE its region, on the patch, so it keeps
        // the quilt's ink; the gutter figures sit on the frame and invert with it.
        className={`dg-csdm-figure is-${interaction}${def.gutter === 'below' ? ' is-inset' : ''}`}
        data-parent-id={def.group ?? ''}
      >
        <HiddenHandles />
        <CsdmRoleGlyph />
        <span className="dg-csdm-figure-label">{def.title}</span>
        {embedMode && def.detail && <NodeNote detail={def.detail} citations={def.citations} />}
      </div>
    );
  }

  const shape = def.shape && def.shape !== 'card' ? def.shape : undefined;
  // The ghosts are the card's own footprint, offset. One constant drives the
  // inset, the ghost size and the space layout reserves for all three.
  const ghostBox = {
    width: `calc(100% - ${CSDM_STACK_PAD}px)`,
    height: `calc(100% - ${CSDM_STACK_PAD}px)`,
  };
  const classes = [
    'dg-csdm-card',
    `is-${interaction}`,
    shape ? `is-${shape}` : '',
    def.stack ? 'is-stack' : '',
    def.status === 'to-confirm' ? 'is-to-confirm' : '',
    def.owner ? 'has-owner' : '',
    def.emphasis === 'primary' ? 'is-primary' : '',
  ].filter(Boolean).join(' ');

  // data-parent-id: React Flow parents are logical, not DOM ancestors, so the
  // layout probe can tell legitimate containment from a chip on a sibling.
  return (
    <div className="dg-csdm-cell" data-parent-id={def.group ?? ''}>
      <HiddenHandles />
      {def.stack && (
        <>
          <span className="dg-csdm-ghost" style={{ ...ghostBox, left: CSDM_STACK_PAD, top: CSDM_STACK_PAD }} />
          <span
            className="dg-csdm-ghost"
            style={{ ...ghostBox, left: CSDM_STACK_PAD / 2, top: CSDM_STACK_PAD / 2 }}
          />
        </>
      )}
      <div
        className={classes}
        style={{
          width: def.stack ? `calc(100% - ${CSDM_STACK_PAD}px)` : '100%',
          height: def.stack ? `calc(100% - ${CSDM_STACK_PAD}px)` : '100%',
          paddingTop: def.owner ? NODE_TAG_ROW_H : undefined,
        }}
      >
        {shape && <ShapeBackdrop shape={shape} />}
        <div className="dg-csdm-card-body">
          {def.owner && <span className={`dg-owner-tag is-${def.owner}`}>{ownerLabel}</span>}
          <div className="dg-csdm-card-title">{def.title}</div>
          {def.subtitle && <div className="dg-csdm-card-subtitle">{def.subtitle}</div>}
          <ControlChips controls={def.controls} />
          {def.status === 'to-confirm' && (
            <div className="dg-node-status" style={{ height: NODE_TAG_ROW_H }}>
              <span className="dg-status-chip">TO CONFIRM</span>
            </div>
          )}
        </div>
      </div>
      {embedMode && def.detail && <NodeNote detail={def.detail} citations={def.citations} />}
    </div>
  );
}

export const CsdmCard = memo(CsdmCardComponent);
