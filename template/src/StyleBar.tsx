import { useMemo } from 'react';
import type { DiagramDef } from './model';

interface StyleBarProps {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  dialect: DiagramDef['dialect'];
  onNodeStyle(patch: Record<string, string | number | null>): void;
  onEdgeStyle(patch: Record<string, string | number | null>): void;
  onClear(): void;
}

/**
 * Swatches come from the diagram's OWN tokens, so restyling stays on-brand:
 * the CSDM domain inks first, then the editorial block colours, then a
 * neutral ramp. The freeform picker beside them feeds the same validated
 * path — every colour, swatch or custom, goes through isValidColor.
 */
const CSDM_SWATCHES = [
  { value: '#2d4b57', label: 'CSDM ink' },
  { value: '#a02b93', label: 'Build' },
  { value: '#0f9ed5', label: 'Design' },
  { value: '#4ea72e', label: 'Ideation' },
  { value: '#f19714', label: 'Delivery' },
  { value: '#54c45e', label: 'Consumption' },
  { value: '#156082', label: 'Catalog' },
];

const BLOCK_SWATCHES = [
  { value: '#dceeb1', label: 'Lime' },
  { value: '#c5b0f4', label: 'Lilac' },
  { value: '#f4ecd6', label: 'Cream' },
  { value: '#c8e6cd', label: 'Mint' },
  { value: '#efd4d4', label: 'Pink' },
  { value: '#f3c9b6', label: 'Coral' },
  { value: '#1f1d3d', label: 'Navy' },
];

const NEUTRAL_SWATCHES = [
  { value: '#000000', label: 'Black' },
  { value: '#4a4a4a', label: 'Graphite' },
  { value: '#9a9a9a', label: 'Grey' },
  { value: '#e6e6e6', label: 'Hairline' },
  { value: '#ffffff', label: 'White' },
  { value: '#ff3d8b', label: 'Accent' },
];

interface SwatchRowProps {
  title: string;
  swatches: Array<{ value: string; label: string }>;
  onPick(value: string): void;
  onClear(): void;
  customLabel: string;
}

function SwatchRow({ title, swatches, onPick, onClear, customLabel }: SwatchRowProps) {
  return (
    <div className="dg-style-row">
      <span className="dg-style-label">{title}</span>
      <div className="dg-style-swatches">
        {swatches.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            className="dg-style-swatch"
            style={{ background: swatch.value }}
            title={swatch.label}
            aria-label={`${title}: ${swatch.label}`}
            onClick={() => onPick(swatch.value)}
          />
        ))}
        <label className="dg-style-swatch dg-style-swatch-custom" title={customLabel}>
          <span aria-hidden="true">+</span>
          <input
            type="color"
            aria-label={customLabel}
            onChange={(event) => onPick(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="dg-style-default"
          title={`Clear the ${title.toLowerCase()} override`}
          onClick={onClear}
        >
          Default
        </button>
      </div>
    </div>
  );
}

/**
 * The style bar, shown over the canvas whenever something is selected in edit
 * mode. Mixed selections are normal — nodes and edges can be lassoed
 * together — so each control renders only when the selection contains
 * something it applies to, and writes only to those elements.
 */
export function StyleBar({
  nodeIds,
  edgeIds,
  dialect,
  onNodeStyle,
  onEdgeStyle,
  onClear,
}: StyleBarProps) {
  const hasNodes = nodeIds.length > 0;
  const hasEdges = edgeIds.length > 0;
  const swatches = useMemo(
    () => (dialect === 'csdm'
      ? [...CSDM_SWATCHES, ...NEUTRAL_SWATCHES]
      : [...BLOCK_SWATCHES, ...NEUTRAL_SWATCHES]),
    [dialect],
  );

  if (!hasNodes && !hasEdges) return null;

  const count = nodeIds.length + edgeIds.length;
  const summary = [
    hasNodes ? `${nodeIds.length} component${nodeIds.length === 1 ? '' : 's'}` : '',
    hasEdges ? `${edgeIds.length} relationship${edgeIds.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="dg-style-bar" role="group" aria-label={`Style ${count} selected element(s)`}>
      <div className="dg-style-head">
        <strong>{summary}</strong>
        <button type="button" className="dg-style-default" onClick={onClear}>
          Clear all
        </button>
      </div>

      {hasNodes && (
        <SwatchRow
          title="Text"
          swatches={swatches}
          customLabel="Custom text colour"
          onPick={(value) => onNodeStyle({ ink: value })}
          onClear={() => onNodeStyle({ ink: null })}
        />
      )}

      {hasNodes && (
        <SwatchRow
          title="Outline"
          swatches={swatches}
          customLabel="Custom outline colour"
          onPick={(value) => onNodeStyle({ border: value })}
          onClear={() => onNodeStyle({ border: null })}
        />
      )}

      {hasEdges && (
        <SwatchRow
          title="Line"
          swatches={swatches}
          customLabel="Custom line colour"
          onPick={(value) => onEdgeStyle({ color: value })}
          onClear={() => onEdgeStyle({ color: null })}
        />
      )}

      <div className="dg-style-row">
        <span className="dg-style-label">Size</span>
        <div className="dg-style-sizes">
          {[0.8, 0.9, 1, 1.15, 1.3, 1.6].map((scale) => (
            <button
              key={scale}
              type="button"
              className="dg-style-size"
              onClick={() => {
                if (hasNodes) onNodeStyle({ textScale: scale });
                if (hasEdges) onEdgeStyle({ labelScale: scale });
              }}
            >
              {Math.round(scale * 100)}%
            </button>
          ))}
          <button
            type="button"
            className="dg-style-default"
            onClick={() => {
              if (hasNodes) onNodeStyle({ textScale: null });
              if (hasEdges) onEdgeStyle({ labelScale: null });
            }}
          >
            Default
          </button>
        </div>
      </div>
    </div>
  );
}
