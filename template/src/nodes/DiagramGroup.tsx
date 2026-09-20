import { memo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { groupHeaderHeight } from '../layout';
import type { DiagramGroupNode } from '../buildGraph';

/**
 * View mode: locked pass-through (pointerEvents none — the shipped-bug rule).
 * Edit mode: the group body accepts pointer events so it can be selected,
 * dragged (children ride along via parentId) and resized via NodeResizer.
 */
function DiagramGroupComponent({ data, selected }: NodeProps<DiagramGroupNode>) {
  const { def, editable } = data;
  const classes = [
    'dg-group',
    `dg-group-${def.kind}`,
    `dg-color-${def.color}`,
    def.status === 'to-confirm' ? 'is-to-confirm' : '',
    def.owner || def.status === 'to-confirm' ? 'has-group-metadata' : '',
    def.lane ? 'is-lane' : '',
    editable ? 'is-editable' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} data-group-id={def.id} data-parent-id={def.parent ?? ''}>
      {editable && (
        <NodeResizer
          isVisible={selected}
          minWidth={240}
          minHeight={140}
          lineStyle={{ borderWidth: 1.5 }}
          handleStyle={{ width: 10, height: 10, borderRadius: 3 }}
        />
      )}
      <div className="dg-group-header" style={{ height: groupHeaderHeight(def) }}>
        {def.kind === 'aws' && !def.lane && (
          <span className="dg-group-glyph" aria-hidden="true">{def.title.at(0)}</span>
        )}
        <span className="dg-group-title">{def.title}</span>
        <div className="dg-group-badges">
          {def.owner && <span className={`dg-owner-chip is-${def.owner.party}`}>{def.owner.label}</span>}
          {def.chip && <span className="dg-group-chip">{def.chip}</span>}
          {def.status === 'to-confirm' && <span className="dg-status-chip">TO CONFIRM</span>}
        </div>
      </div>
    </div>
  );
}

export const DiagramGroup = memo(DiagramGroupComponent);
