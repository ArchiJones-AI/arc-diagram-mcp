import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { CsdmHubNode } from '../buildGraph';
import { CsdmDomainIcon } from './CsdmGlyphs';

/**
 * The Manage Portfolio hub: one non-interactive chrome node, a white circle
 * sitting in the channel where the four corner regions meet. It holds no
 * cards, so it carries only its title and glyph — and it is registered as an
 * obstacle for the edge-label placer in the same change that renders it.
 */
function CsdmHubComponent({ data }: NodeProps<CsdmHubNode>) {
  return (
    <div className="dg-csdm-hub" aria-hidden="true">
      <span className="dg-csdm-hub-title">{data.title}</span>
      <CsdmDomainIcon icon={data.icon} />
    </div>
  );
}

export const CsdmHub = memo(CsdmHubComponent);
