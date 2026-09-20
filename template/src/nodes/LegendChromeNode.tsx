import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { LegendChromeNode as LegendNode } from '../buildGraph';
import { LEGEND_COLUMNS, LEGEND_GAP, LEGEND_PAD } from '../layout';

/**
 * The in-canvas legend that resolves every control tag on the view. Same
 * pattern as PyramidChrome: a non-interactive node at zIndex -10 that the
 * exporter's node-bounds crop keeps in frame for free. Party names arrive
 * resolved on `data.administrators` — no customer or supplier name is
 * compiled into this component.
 */
function LegendChromeComponent({ data }: NodeProps<LegendNode>) {
  return (
    <section className="dg-legend" style={{ padding: LEGEND_PAD }} aria-label={data.legend.title}>
      <h2>{data.legend.title}</h2>
      <div className="dg-legend-groups" style={{ gridTemplateColumns: `repeat(${LEGEND_COLUMNS}, minmax(0, 1fr))`, gap: LEGEND_GAP }}>
        {data.legend.groups.map((group, index) => (
          <div className="dg-legend-group" key={`${index}-${group.heading}`}>
            <h3>{group.heading}</h3>
            {group.items.map((item, itemIndex) => (
              <div className="dg-legend-item" key={`${itemIndex}-${item.tag}`}>
                <p><strong>{item.tag}</strong> — {item.meaning}</p>
                {item.analogy && <p className="dg-legend-analogy">{item.analogy}</p>}
                {item.administeredBy.length > 0 && (
                  <p className="dg-legend-admin">administered by {item.administeredBy.map((party) => data.administrators[party] ?? party).join(' · ')}</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export const LegendChromeNode = memo(LegendChromeComponent);
