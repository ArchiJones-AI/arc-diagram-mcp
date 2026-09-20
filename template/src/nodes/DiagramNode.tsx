import { memo } from 'react';
import {
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import type { DiagramLeafNode } from '../buildGraph';
import { NODE_TAG_ROW_H } from '../layout';
import { ControlChips } from './ControlChips';
import { NodeNote } from './NodeNote';

const positions = [
  ['left', Position.Left],
  ['right', Position.Right],
  ['top', Position.Top],
  ['bottom', Position.Bottom],
] as const;

function HiddenHandles() {
  return positions.flatMap(([name, position]) => [
    <Handle
      key={`${name}-source`}
      id={`${name}-source`}
      className="dg-handle"
      type="source"
      position={position}
      isConnectable={false}
    />,
    <Handle
      key={`${name}-target`}
      id={`${name}-target`}
      className="dg-handle"
      type="target"
      position={position}
      isConnectable={false}
    />,
  ]);
}

function DiagramNodeComponent({ data }: NodeProps<DiagramLeafNode>) {
  const { def, groupKind, interaction, embedMode, ownerLabel } = data;
  const classes = [
    'dg-node-card',
    `is-${interaction}`,
    groupKind === 'block' ? 'is-light-island' : '',
    def.status === 'to-confirm' ? 'is-to-confirm' : '',
    def.owner ? 'has-owner' : '',
    def.emphasis === 'primary' ? 'is-primary' : '',
  ].filter(Boolean).join(' ');

  // data-parent-id: React Flow parents are logical, not DOM ancestors, so the
  // layout probe needs the authored parent to tell legitimate containment
  // from an annotation sitting on a sibling card.
  return (
    <div className={classes} data-parent-id={def.group ?? ''} style={{ paddingTop: def.owner ? NODE_TAG_ROW_H : undefined }}>
      <HiddenHandles />
      {def.owner && <span className={`dg-owner-tag is-${def.owner}`}>{ownerLabel}</span>}
      {def.eyebrow && <div className="dg-node-eyebrow">{def.eyebrow}</div>}
      <div className="dg-node-title">{def.title}</div>
      <ControlChips controls={def.controls} />
      {def.subtitle && <div className="dg-node-subtitle">{def.subtitle}</div>}
      {def.status === 'to-confirm' && <div className="dg-node-status" style={{ height: NODE_TAG_ROW_H }}><span className="dg-status-chip">TO CONFIRM</span></div>}
      {embedMode && def.detail && <NodeNote detail={def.detail} citations={def.citations} />}
    </div>
  );
}

export const DiagramNode = memo(DiagramNodeComponent);
