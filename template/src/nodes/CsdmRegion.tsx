import { memo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { CSDM_REGION_RADIUS, groupHeaderHeight } from '../layout';
import type { DiagramGroupNode } from '../buildGraph';
import { CsdmDomainIcon } from './CsdmGlyphs';

/**
 * Outer corners of a quilt patch are generously rounded; the corner that
 * faces the hub is square, so the circle can sit over the join exactly as the
 * source draws it. Derived from the domain, never hand-placed.
 */
function cornerRadius(domain?: string): string {
  const r = `${CSDM_REGION_RADIUS}px`;
  if (domain === 'build') return `${r} ${r} 0 ${r}`;
  if (domain === 'design') return `${r} ${r} ${r} 0`;
  if (domain === 'delivery') return `${r} 0 ${r} ${r}`;
  if (domain === 'consumption') return `0 ${r} ${r} ${r}`;
  return r;
}

/**
 * A csdm region (a domain patch) or, when the group carries a `parent` and no
 * `domain`, a tinted sub-box inset inside one. View mode: locked pass-through.
 * Edit mode: selectable, draggable, resizable, like every other group.
 */
function CsdmRegionComponent({ data, selected }: NodeProps<DiagramGroupNode>) {
  const { def, editable } = data;
  const isSub = !def.domain;
  const classes = [
    'dg-csdm-region',
    isSub ? 'is-sub' : `dg-csdm-${def.domain}`,
    isSub && def.color === 'navy' ? 'is-catalog' : '',
    def.status === 'to-confirm' ? 'is-to-confirm' : '',
    editable ? 'is-editable' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      data-group-id={def.id}
      data-parent-id={def.parent ?? ''}
      style={{ borderRadius: isSub ? '10px' : cornerRadius(def.domain) }}
    >
      {editable && (
        <NodeResizer
          isVisible={selected}
          minWidth={200}
          minHeight={120}
          lineStyle={{ borderWidth: 1.5 }}
          handleStyle={{ width: 10, height: 10, borderRadius: 3 }}
        />
      )}
      <div className="dg-csdm-region-header" style={{ height: groupHeaderHeight(def) }}>
        <div className="dg-csdm-region-titlerow">
          {def.icon && <CsdmDomainIcon icon={def.icon} />}
          <span className="dg-csdm-region-title">{def.title}</span>
          {def.status === 'to-confirm' && <span className="dg-status-chip">TO CONFIRM</span>}
        </div>
        {!!def.chips?.length && (
          <div className="dg-csdm-chips">
            {def.chips.map((chip) => (
              <span className="dg-csdm-chip" key={chip}>{chip}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const CsdmRegion = memo(CsdmRegionComponent);
