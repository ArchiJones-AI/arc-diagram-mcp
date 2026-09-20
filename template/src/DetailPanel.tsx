import type { DiagramDef, DiagramLegend, DiagramNodeDef } from './model';
import { Citations } from './nodes/Citations';

/** Warn once per tag, not once per render. */
const warnedTags = new Set<string>();

interface DetailPanelProps {
  diagram: DiagramDef;
  node?: DiagramNodeDef;
  /** The legend the panel resolves control tags against — this view's own, or
   *  the set's fallback vocabulary when the view carries no legend node. */
  legend?: DiagramLegend;
}

export function DetailPanel({ diagram, node, legend }: DetailPanelProps) {
  const group = diagram.groups.find((candidate) => candidate.id === node?.group);
  const groupTitle = group?.title ?? 'CANVAS';
  const controls = new Map(legend?.groups.flatMap((entry) => entry.items.map((item) => [item.tag, item.meaning] as const)) ?? []);

  return (
    <section className="dg-detail-panel" aria-label="Component detail" aria-live="polite">
      {!node ? (
        <p className="dg-detail-empty">Click a component to inspect its role and source citations.</p>
      ) : (
        <>
          <div className="dg-detail-eyebrow">{groupTitle}</div>
          {group?.owner && (
            <p className="dg-detail-owner">
              {group.owner.label}
              {group.owner.team && <span>{group.owner.team}</span>}
            </p>
          )}
          <h2>{node.title}</h2>
          {node.subtitle && <p className="dg-detail-role">{node.subtitle}</p>}
          {node.detail && <p className="dg-detail-copy">{node.detail}</p>}
          {!!node.controls?.length && (
            <div className="dg-detail-controls">
              <div className="dg-detail-eyebrow">CONTROLS</div>
              {node.controls.map((tag) => {
                // A tag with no legend entry renders as a bare code the reader
                // cannot interpret. `npm run lint:text` catches this at build
                // time, but the lint is config-gated and this is not: say it
                // loudly here too, the same way buildGraph shouts about an
                // edge that will not render.
                if (!controls.has(tag) && import.meta.env.DEV && !warnedTags.has(tag)) {
                  warnedTags.add(tag);
                  console.error(`[arc-diagram] ${diagram.id}: control "${tag}" on node "${node.id}" resolves to no legend item; it renders as a bare code with no meaning. Add it to this view's legend, or to the view that declares the shared vocabulary.`);
                }
                return <p key={tag}><code>{tag}</code>{controls.has(tag) ? ` — ${controls.get(tag)}` : ''}</p>;
              })}
            </div>
          )}
          <Citations citations={node.citations} variant="panel" />
          {node.steps && node.steps.length > 0 && (
            <p className="dg-detail-steps">
              <span>RUNTIME STEPS</span>
              {node.steps.join(' · ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
