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

function AwsTileComponent({ data }: NodeProps<DiagramLeafNode>) {
  const { def, groupColor, interaction, embedMode, ownerLabel } = data;
  const classes = [
    'dg-aws-node',
    `dg-color-${groupColor}`,
    `is-${interaction}`,
    def.status === 'to-confirm' ? 'is-to-confirm' : '',
    def.owner ? 'has-owner' : '',
    def.emphasis === 'primary' ? 'is-primary' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} data-parent-id={def.group ?? ''} style={{ paddingTop: def.owner ? NODE_TAG_ROW_H : undefined }}>
      <HiddenHandles />
      {def.owner && <span className={`dg-owner-tag is-${def.owner}`}>{ownerLabel}</span>}
      <div className="dg-aws-glyph" aria-hidden="true">{def.glyph ?? def.title.at(0)}</div>
      <div className="dg-aws-label">{def.title}</div>
      <ControlChips controls={def.controls} />
      {def.status === 'to-confirm' && <div className="dg-node-status" style={{ height: NODE_TAG_ROW_H }}><span className="dg-status-chip">TO CONFIRM</span></div>}
      {embedMode && def.detail && <NodeNote detail={def.detail} citations={def.citations} />}
    </div>
  );
}

export const AwsTile = memo(AwsTileComponent);
